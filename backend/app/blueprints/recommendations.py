from flask import Blueprint, jsonify, request, current_app

recommendations_bp = Blueprint('recommendations', __name__)


@recommendations_bp.route('/movie', methods=['GET'])
def get_gaps_for_movie():
    """Find collection gaps for a single movie."""
    movie_id = request.args.get('movieId', type=int)
    library_name = request.args.get('libraryName', default='', type=str)
    show_existing = request.args.get('showExisting', 'false').lower() == 'true'

    if not movie_id:
        return jsonify(error='movieId parameter is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    # Get owned TMDB IDs from the movies cache
    cache = current_app.plex_service.movies_cache
    library_data = cache.get(library_name, {})
    owned_ids = set(library_data.get('tmdbIds', []))

    gaps, error = current_app.tmdb_service.find_gaps_for_movie(
        api_key=api_key,
        tmdb_id=movie_id,
        owned_tmdb_ids=owned_ids,
        show_existing=show_existing,
    )

    if error:
        return jsonify(error=error), 500

    return jsonify(gaps=gaps)


@recommendations_bp.route('/scan', methods=['POST'])
def scan_library_gaps():
    """Scan an entire library and find all collection gaps."""
    data = request.get_json() or {}
    library_name = data.get('libraryName', '')
    show_existing = data.get('showExisting', False)

    if not library_name:
        return jsonify(error='libraryName is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    # Get owned TMDB IDs from the movies cache
    cache = current_app.plex_service.movies_cache
    library_data = cache.get(library_name, {})
    owned_ids = set(library_data.get('tmdbIds', []))

    if not owned_ids:
        return jsonify(error='No movies loaded for this library. Browse the library first to load movie data.'), 400

    gaps, error = current_app.tmdb_service.find_collection_gaps(
        api_key=api_key,
        owned_tmdb_ids=owned_ids,
        show_existing=show_existing,
    )

    if error:
        return jsonify(error=error), 500

    return jsonify(gaps=gaps, totalOwned=len(owned_ids))
