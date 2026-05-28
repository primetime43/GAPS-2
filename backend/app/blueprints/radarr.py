import logging
from flask import Blueprint, jsonify, request, current_app
import requests

logger = logging.getLogger(__name__)

radarr_bp = Blueprint('radarr', __name__)


@radarr_bp.route('/config', methods=['GET'])
def get_config():
    cfg = current_app.radarr_service.get_config()
    # Reveal the real API key only when the UI explicitly asks (via the Show
    # button); otherwise echo a masked placeholder.
    reveal = request.args.get('reveal', 'false').lower() == 'true'
    if not reveal:
        cfg['api_key'] = '••••••' if cfg.get('api_key') else ''
    return jsonify(cfg)


@radarr_bp.route('/config', methods=['POST'])
def save_config():
    data = request.get_json() or {}
    # If the client posts back the masked placeholder, preserve the stored key.
    api_key = data.get('api_key', '')
    if api_key and set(api_key) == {'•'}:
        from app.services import config_store
        data['api_key'] = (config_store.get('radarr', {}) or {}).get('api_key', '')
    saved = current_app.radarr_service.save_config(data)
    saved['api_key'] = '••••••' if saved.get('api_key') else ''
    return jsonify(saved)


@radarr_bp.route('/config', methods=['DELETE'])
def clear_config():
    current_app.radarr_service.clear_config()
    return jsonify(message='Radarr config cleared')


@radarr_bp.route('/test', methods=['POST'])
def test_connection():
    data = request.get_json() or {}
    url = data.get('url', '')
    api_key = data.get('api_key', '')
    # Masked placeholder means "use the stored key" so users can re-test without re-typing.
    if api_key and set(api_key) == {'•'}:
        from app.services import config_store
        api_key = (config_store.get('radarr', {}) or {}).get('api_key', '')

    ok, msg = current_app.radarr_service.test_connection(url, api_key)
    if ok:
        return jsonify(message=msg)
    return jsonify(error=msg), 400


@radarr_bp.route('/profiles', methods=['GET'])
def get_profiles():
    try:
        return jsonify(current_app.radarr_service.get_quality_profiles())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@radarr_bp.route('/root-folders', methods=['GET'])
def get_root_folders():
    try:
        return jsonify(current_app.radarr_service.get_root_folders())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@radarr_bp.route('/movies', methods=['GET'])
def get_movies():
    """Return TMDB ids already in the Radarr library, so the UI can flag them."""
    try:
        return jsonify(tmdb_ids=current_app.radarr_service.get_library_tmdb_ids())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@radarr_bp.route('/add', methods=['POST'])
def add_movie():
    data = request.get_json() or {}
    tmdb_id = data.get('tmdb_id')
    if not isinstance(tmdb_id, int) or tmdb_id <= 0:
        return jsonify(error='tmdb_id is required'), 400

    title = data.get('title', '')
    year = data.get('year', 0) or 0

    ok, msg = current_app.radarr_service.add_movie(tmdb_id, title=title, year=year)
    if ok:
        return jsonify(message=msg)
    return jsonify(error=msg), 400
