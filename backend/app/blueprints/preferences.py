from flask import Blueprint, jsonify, request, current_app
from app.services import config_store

preferences_bp = Blueprint('preferences', __name__)

DEFAULTS = {
    'defaultLibrary': '',
    'moviesPerPage': 50,
    'hideOwnedByDefault': False,
    'language': 'en',
    'port': 4277,
    'autoOpenBrowser': True,
    'posterPrefetch': False,
    'imageCacheEnabled': False,
    'mediaServerTimeout': 30,
}


@preferences_bp.route('', methods=['GET'])
def get_preferences():
    saved = config_store.get('preferences', {})
    prefs = {**DEFAULTS, **saved}
    return jsonify(prefs)


@preferences_bp.route('', methods=['POST'])
def save_preferences():
    data = request.get_json() or {}
    # Only save known keys
    saved = config_store.get('preferences', {})
    for key in DEFAULTS:
        if key in data:
            saved[key] = data[key]
    config_store.put('preferences', saved)
    # Notify services of preference changes
    current_app.tmdb_service.reload_preferences()
    prefs = {**DEFAULTS, **saved}
    return jsonify(prefs)
