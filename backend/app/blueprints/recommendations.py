from flask import Blueprint, jsonify, request, current_app
from app.services import config_store

recommendations_bp = Blueprint('recommendations', __name__)


def _get_service(source: str):
    """Get the appropriate media server service."""
    if source == 'jellyfin':
        return current_app.jellyfin_service
    elif source == 'emby':
        return current_app.emby_service
    else:
        return current_app.plex_service


def _get_movies_cache(source: str) -> dict:
    """Get the movies cache from the appropriate media server service."""
    return _get_service(source).movies_cache


@recommendations_bp.route('/movie', methods=['GET'])
def get_gaps_for_movie():
    """Find collection gaps for a single movie."""
    movie_id = request.args.get('movieId', type=int)
    imdb_id = request.args.get('imdbId', default=None, type=str)
    title = request.args.get('title', default=None, type=str)
    year = request.args.get('year', default=None, type=int)
    library_name = request.args.get('libraryName', default='', type=str)
    library_names = request.args.getlist('libraryNames')
    source = request.args.get('source', default='plex', type=str)
    show_existing = request.args.get('showExisting', 'false').lower() == 'true'

    if not movie_id and not imdb_id and not title:
        return jsonify(error='movieId, imdbId, or title parameter is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    cache = _get_movies_cache(source)
    # Merge owned IDs from all specified libraries
    names = library_names if library_names else ([library_name] if library_name else [])
    owned_ids = set()
    for name in names:
        library_data = cache.get(name, {})
        owned_ids.update(library_data.get('tmdbIds', []))

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
    library_names = data.get('libraryNames', [])
    source = data.get('source', 'plex')
    show_existing = data.get('showExisting', False)
    fresh_scan = data.get('freshScan', False)

    # Support both single and multiple library names
    names = library_names if library_names else ([library_name] if library_name else [])
    if not names:
        return jsonify(error='libraryName or libraryNames is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    tmdb = current_app.tmdb_service

    if tmdb.scan_progress.get('status') == 'scanning':
        return jsonify(error='A scan is already in progress'), 409

    service = _get_service(source)

    if fresh_scan:
        tmdb.clear_cache()
        # Clear cached movie lists so we re-fetch from the media server
        service.clear_movies_cache()
        # Re-fetch movies for the selected libraries
        for name in names:
            service.get_movies(name)

    cache = service.movies_cache

    # Merge movies and IDs from all selected libraries
    owned_movies = []
    owned_ids = set()
    seen_keys = set()
    for name in names:
        library_data = cache.get(name, {})
        for movie in library_data.get('movies', []):
            # Deduplicate by tmdbId or name+year
            key = movie.get('tmdbId') or f"{movie.get('name')}|{movie.get('year')}"
            if key not in seen_keys:
                seen_keys.add(key)
                owned_movies.append(movie)
        owned_ids.update(library_data.get('tmdbIds', []))

    if not owned_movies:
        return jsonify(error='No movies loaded for the selected libraries. Browse the libraries first to load movie data.'), 400

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


@recommendations_bp.route('/ignored', methods=['GET'])
def get_ignored():
    """Return the list of ignored TMDB IDs."""
    ignored = config_store.get('ignored_movies', [])
    return jsonify(ignored=ignored)


@recommendations_bp.route('/ignored', methods=['POST'])
def add_ignored():
    """Add one or more movies to the ignored list."""
    data = request.get_json() or {}
    tmdb_id = data.get('tmdbId')
    tmdb_ids = data.get('tmdbIds', [])
    if not tmdb_id and not tmdb_ids:
        return jsonify(error='tmdbId or tmdbIds is required'), 400
    ignored = config_store.get('ignored_movies', [])
    ids_to_add = tmdb_ids if tmdb_ids else [tmdb_id]
    changed = False
    for tid in ids_to_add:
        if tid not in ignored:
            ignored.append(tid)
            changed = True
    if changed:
        config_store.put('ignored_movies', ignored)
    return jsonify(result='ok')


@recommendations_bp.route('/ignored', methods=['DELETE'])
def remove_ignored():
    """Remove one or more movies from the ignored list."""
    data = request.get_json() or {}
    tmdb_id = data.get('tmdbId')
    tmdb_ids = data.get('tmdbIds', [])
    if not tmdb_id and not tmdb_ids:
        return jsonify(error='tmdbId or tmdbIds is required'), 400
    ignored = config_store.get('ignored_movies', [])
    ids_to_remove = set(tmdb_ids if tmdb_ids else [tmdb_id])
    new_ignored = [i for i in ignored if i not in ids_to_remove]
    if len(new_ignored) != len(ignored):
        config_store.put('ignored_movies', new_ignored)
    return jsonify(result='ok')
