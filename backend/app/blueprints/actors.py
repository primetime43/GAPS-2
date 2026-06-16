from flask import Blueprint, jsonify, request, current_app
from app.services.media_servers import media_service_for

actors_bp = Blueprint('actors', __name__)


def _get_service(source: str):
    """Get the appropriate media server service."""
    return media_service_for(current_app, source)


@actors_bp.route('/search', methods=['GET'])
def search_actors():
    """Search TMDB for actors/actresses by name."""
    query = request.args.get('query', default='', type=str).strip()
    if not query:
        return jsonify(error='query parameter is required'), 400

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    results = current_app.tmdb_service.search_people(query)
    return jsonify(results=results)


@actors_bp.route('/<int:person_id>/gaps', methods=['GET'])
def actor_gaps(person_id):
    """Find owned/missing movies for an actor across the selected libraries."""
    source = request.args.get('source', default='plex', type=str)
    library_name = request.args.get('libraryName', default='', type=str)
    library_names = request.args.getlist('libraryNames')
    show_existing = request.args.get('showExisting', 'true').lower() == 'true'
    include_minor = request.args.get('includeMinor', 'false').lower() == 'true'

    api_key = current_app.tmdb_service.api_key
    if not api_key:
        return jsonify(error='No TMDB API key configured'), 400

    names = library_names if library_names else ([library_name] if library_name else [])
    if not names:
        return jsonify(error='libraryName or libraryNames is required'), 400

    service = _get_service(source)

    # Load any selected library that isn't cached yet so the user doesn't have
    # to "browse first". `movies_cache` returns a fresh snapshot on each access,
    # so read it *after* loading — otherwise newly loaded libraries are missing
    # from the snapshot and every movie would look un-owned.
    for name in names:
        if name not in service.movies_cache:
            service.get_movies(name)
    cache = service.movies_cache

    # Build the owned set from the selected libraries.
    owned_movies = []
    owned_ids = set()
    seen_keys = set()
    for name in names:
        library_data = cache.get(name, {})
        for movie in library_data.get('movies', []):
            key = movie.get('tmdbId') or f"{movie.get('name')}|{movie.get('year')}"
            if key not in seen_keys:
                seen_keys.add(key)
                owned_movies.append(movie)
        owned_ids.update(library_data.get('tmdbIds', []))

    gaps, error = current_app.tmdb_service.get_actor_gaps(
        person_id=person_id,
        owned_tmdb_ids=owned_ids,
        owned_movies=owned_movies,
        show_existing=show_existing,
        include_minor=include_minor,
    )

    if error:
        return jsonify(error=error), 500

    actor = current_app.tmdb_service.get_person_details(person_id)
    return jsonify(gaps=gaps, actor=actor)
