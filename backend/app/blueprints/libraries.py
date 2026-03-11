import requests as http_requests
from flask import Blueprint, jsonify, request, current_app, Response

libraries_bp = Blueprint('libraries', __name__)


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
        return jsonify(error=error)
    return jsonify(movies=movies)


@libraries_bp.route('/image-proxy', methods=['GET'])
def image_proxy():
    """Proxy poster images from media servers to avoid exposing API keys in browser."""
    source = request.args.get('source', '')
    item_id = request.args.get('itemId', '')
    thumb = request.args.get('thumb', '')

    if not source or (not item_id and not thumb):
        return jsonify(error='Missing parameters'), 400

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
        return Response(
            resp.content,
            content_type=content_type,
            headers={'Cache-Control': 'public, max-age=86400'},
        )

    except Exception:
        return Response('Image not found', status=404)
