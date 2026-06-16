from flask import Blueprint, jsonify, request, current_app
from app.services import config_store

preferences_bp = Blueprint('preferences', __name__)

# Mirrored on the frontend by DEFAULT_PREFERENCES in
# frontend/src/app/services/preferences.service.ts — keep the two in sync when
# adding a preference.
DEFAULTS = {
    'defaultLibrary': '',
    'moviesPerPage': 50,
    'hideOwnedByDefault': False,
    'hideFutureReleasesByDefault': False,
    'language': 'en',
    'port': 4277,
    'autoOpenBrowser': True,
    'posterPrefetch': False,
    'imageCacheEnabled': False,
    'mediaServerTimeout': 30,
    # Quality filter — exclude low-tier movie gaps (issue #47). When enabled,
    # already-released missing movies below either threshold are dropped from
    # scan results. Unreleased titles are exempt (use hideFutureReleases for those).
    'qualityFilterEnabled': False,
    'minRating': 0.0,       # TMDB vote_average, 0–10
    'minVoteCount': 0,      # TMDB vote_count (number of ratings)
    # Where movie poster/title clicks go: 'tmdb' or 'imdb'. IMDb
    # links resolve lazily through the backend (TMDB list responses don't carry
    # IMDb IDs); TV titles always link to TheTVDB regardless of this setting.
    'externalLinkProvider': 'tmdb',
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
