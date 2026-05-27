import logging
from flask import Blueprint, jsonify, request, current_app
import requests

logger = logging.getLogger(__name__)

sonarr_bp = Blueprint('sonarr', __name__)


@sonarr_bp.route('/config', methods=['GET'])
def get_config():
    cfg = current_app.sonarr_service.get_config()
    # Reveal the real API key only when the UI explicitly asks (via the Show
    # button); otherwise echo a masked placeholder.
    reveal = request.args.get('reveal', 'false').lower() == 'true'
    if not reveal:
        cfg['api_key'] = '••••••' if cfg.get('api_key') else ''
    return jsonify(cfg)


@sonarr_bp.route('/config', methods=['POST'])
def save_config():
    data = request.get_json() or {}
    api_key = data.get('api_key', '')
    if api_key and set(api_key) == {'•'}:
        from app.services import config_store
        data['api_key'] = (config_store.get('sonarr', {}) or {}).get('api_key', '')
    saved = current_app.sonarr_service.save_config(data)
    saved['api_key'] = '••••••' if saved.get('api_key') else ''
    return jsonify(saved)


@sonarr_bp.route('/config', methods=['DELETE'])
def clear_config():
    current_app.sonarr_service.clear_config()
    return jsonify(message='Sonarr config cleared')


@sonarr_bp.route('/test', methods=['POST'])
def test_connection():
    data = request.get_json() or {}
    url = data.get('url', '')
    api_key = data.get('api_key', '')
    if api_key and set(api_key) == {'•'}:
        from app.services import config_store
        api_key = (config_store.get('sonarr', {}) or {}).get('api_key', '')

    ok, msg = current_app.sonarr_service.test_connection(url, api_key)
    if ok:
        return jsonify(message=msg)
    return jsonify(error=msg), 400


@sonarr_bp.route('/profiles', methods=['GET'])
def get_profiles():
    try:
        return jsonify(current_app.sonarr_service.get_quality_profiles())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@sonarr_bp.route('/root-folders', methods=['GET'])
def get_root_folders():
    try:
        return jsonify(current_app.sonarr_service.get_root_folders())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@sonarr_bp.route('/series', methods=['GET'])
def get_series():
    """Return TheTVDB ids already in the Sonarr library, so the UI can flag them."""
    try:
        return jsonify(tvdb_ids=current_app.sonarr_service.get_library_tvdb_ids())
    except requests.exceptions.RequestException as e:
        return jsonify(error=str(e)), 502


@sonarr_bp.route('/add', methods=['POST'])
def add_series():
    data = request.get_json() or {}
    tvdb_id = data.get('tvdb_id')
    if not isinstance(tvdb_id, int) or tvdb_id <= 0:
        return jsonify(error='tvdb_id is required'), 400

    title = data.get('title', '')
    ok, msg = current_app.sonarr_service.add_series(tvdb_id, title=title)
    if ok:
        return jsonify(message=msg)
    return jsonify(error=msg), 400
