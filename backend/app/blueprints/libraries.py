import logging
import threading
import time
from collections import OrderedDict

import requests as http_requests
from flask import Blueprint, jsonify, request, current_app, Response

logger = logging.getLogger(__name__)

libraries_bp = Blueprint('libraries', __name__)

# ---------- In-memory LRU image cache ----------
_IMAGE_CACHE_MAX = 200
_IMAGE_CACHE_TTL = 3600  # 1 hour

_image_cache: OrderedDict[str, tuple[bytes, str, float]] = OrderedDict()
_image_cache_lock = threading.Lock()


def _cache_get(key: str) -> tuple[bytes, str] | None:
    with _image_cache_lock:
        entry = _image_cache.get(key)
        if entry is None:
            return None
        data, content_type, ts = entry
        if time.time() - ts > _IMAGE_CACHE_TTL:
            _image_cache.pop(key, None)
            return None
        _image_cache.move_to_end(key)
        return data, content_type


def _cache_put(key: str, data: bytes, content_type: str) -> None:
    with _image_cache_lock:
        _image_cache[key] = (data, content_type, time.time())
        _image_cache.move_to_end(key)
        while len(_image_cache) > _IMAGE_CACHE_MAX:
            _image_cache.popitem(last=False)


def _get_service(source: str):
    """Get the media server service by source name."""
    if source == 'jellyfin':
        return current_app.jellyfin_service
    elif source == 'emby':
        return current_app.emby_service
    else:
        return current_app.plex_service


@libraries_bp.route('/movies', methods=['GET'])
def get_movies():
    library_name = request.args.get('library_name')
    source = request.args.get('source', 'plex')

    if not library_name:
        return jsonify(error='library_name parameter is required'), 400

    service = _get_service(source)
    movies, error = service.get_movies(library_name)
    if error:
        return jsonify(error=error), 500
    return jsonify(movies=movies)


@libraries_bp.route('/image-proxy', methods=['GET'])
def image_proxy():
    """Proxy poster images from media servers to avoid exposing API keys in browser."""
    source = request.args.get('source', '')
    item_id = request.args.get('itemId', '')
    thumb = request.args.get('thumb', '')

    if not source or (not item_id and not thumb):
        return jsonify(error='Missing parameters'), 400

    # Check if server-side image cache is enabled
    from app.services import config_store
    prefs = config_store.get('preferences', {})
    use_cache = prefs.get('imageCacheEnabled', False)

    cache_key = f"{source}:{item_id or thumb}"

    if use_cache:
        cached = _cache_get(cache_key)
        if cached:
            return Response(
                cached[0],
                content_type=cached[1],
                headers={'Cache-Control': 'public, max-age=86400'},
            )

    try:
        if source == 'plex':
            service = current_app.plex_service
            active = service.get_active_server()
            if not active:
                return jsonify(error='No active server'), 404
            token = active.get('token', '')
            # For Plex, use the stored server URL or try to get it from the connection
            server_url = active.get('serverUrl', '')
            if not server_url and service._server_conn:
                server_url = service._server_conn._baseurl
            if not server_url:
                return jsonify(error='No server URL'), 404
            url = f"{server_url.rstrip('/')}{thumb}"
            headers = {'X-Plex-Token': token}

        elif source in ('jellyfin', 'emby'):
            service = current_app.jellyfin_service if source == 'jellyfin' else current_app.emby_service
            if not service._server_url or not service._api_key:
                return jsonify(error='Not connected'), 404
            url = f"{service._base()}/Items/{item_id}/Images/Primary?maxHeight=300"
            headers = {'X-Emby-Token': service._api_key}

        else:
            return jsonify(error='Unknown source'), 400

        resp = http_requests.get(url, headers=headers, timeout=10, stream=True)
        if resp.status_code != 200:
            return Response('Image not found', status=404)

        content_type = resp.headers.get('Content-Type', 'image/jpeg')
        image_data = resp.content

        if use_cache:
            _cache_put(cache_key, image_data, content_type)

        return Response(
            image_data,
            content_type=content_type,
            headers={'Cache-Control': 'public, max-age=86400'},
        )

    except Exception as e:
        logger.warning("Image proxy failed for source=%s: %s", source, e)
        return Response('Image not found', status=404)
