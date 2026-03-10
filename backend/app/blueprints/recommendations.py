from flask import Blueprint, jsonify, request, current_app

recommendations_bp = Blueprint('recommendations', __name__)


@recommendations_bp.route('/movie', methods=['GET'])
def get_gaps_for_movie():
    """Find collection gaps for a single movie."""
    movie_id = request.args.get('movieId', type=int)
    imdb_id = request.args.get('imdbId', default=None, type=str)
    title = request.args.get('title', default=None, type=str)
    year = request.args.get('year', default=None, type=int)
    library_name = request.args.get('libraryName', default='', type=str)
    show_existing = request.args.get('showExisting', 'false').lower() == 'true'

    if not movie_id and not imdb_id and not title:
        return jsonify(error='movieId, imdbId, or title parameter is required'), 400

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
        imdb_id=imdb_id,
        title=title,
        year=year,
    )

    if error:
        return jsonify(error=error), 500

    return jsonify(gaps=gaps)


@recommendations_bp.route('/scan', methods=['POST'])
def scan_library_gaps():
    """Start a library scan in the background."""
    data = request.get_json() or {}
    library_name = data.get('libraryName', '')
    show_existing = data.get('showExisting', False)
    fresh_scan = data.get('freshScan', False)

    if not library_name:
        return jsonify(error='libraryName is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    tmdb = current_app.tmdb_service

    if tmdb.scan_progress.get('status') == 'scanning':
        return jsonify(error='A scan is already in progress'), 409

    # Get movie data from the cache
    cache = current_app.plex_service.movies_cache
    library_data = cache.get(library_name, {})
    owned_movies = library_data.get('movies', [])
    owned_ids = set(library_data.get('tmdbIds', []))

    if not owned_movies:
        return jsonify(error='No movies loaded for this library. Browse the library first to load movie data.'), 400

    if fresh_scan:
        tmdb.clear_cache()

    tmdb.start_scan(
        api_key=api_key,
        owned_movies=owned_movies,
        owned_tmdb_ids=owned_ids,
        show_existing=show_existing,
    )

    return jsonify(status='started', total=len(owned_movies))


@recommendations_bp.route('/scan/progress', methods=['GET'])
def scan_progress():
    """Poll for scan progress."""
    progress = current_app.tmdb_service.scan_progress
    return jsonify(progress)
