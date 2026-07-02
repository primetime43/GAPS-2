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


@actors_bp.route('/popular', methods=['GET'])
def popular_actors():
    """Suggested actors for the empty-search grid, from popular movies or TV
    shows depending on the active tab (mediaType)."""
    if not current_app.tmdb_service.api_key:
        return jsonify(error='No TMDB API key configured'), 400
    media_type = request.args.get('mediaType', default='movie', type=str).lower()
    # ?refresh=true bypasses the cache and rebuilds now (the manual Refresh button).
    force = request.args.get('refresh', 'false').lower() == 'true'
    people, refreshed_at, next_refresh_at = current_app.tmdb_service.get_popular_people(
        media_type, force=force)
    # Unix epoch seconds (or null): when the list was built and when it goes stale,
    # so the UI can show both. The cache is lazy — it rebuilds on the first request
    # after nextRefreshAt, not on a timer.
    return jsonify(results=people, refreshedAt=refreshed_at, nextRefreshAt=next_refresh_at)


@actors_bp.route('/<int:person_id>/gaps', methods=['GET'])
def actor_gaps(person_id):
    """Find owned/missing movies or TV shows for an actor across libraries."""
    source = request.args.get('source', default='plex', type=str)
    library_name = request.args.get('libraryName', default='', type=str)
    library_names = request.args.getlist('libraryNames')
    show_existing = request.args.get('showExisting', 'true').lower() == 'true'
    include_minor = request.args.get('includeMinor', 'false').lower() == 'true'
    # The client signals whether it wants IMDb ratings attached to TV gaps (it
    # reflects the user's display toggle). The backend doesn't read the UI
    # preference itself — that keeps display concerns on the client side.
    include_imdb_ratings = request.args.get('includeImdbRatings', 'false').lower() == 'true'
    media_type = request.args.get('mediaType', default='movie', type=str).lower()

    tmdb = current_app.tmdb_service
    if not tmdb.api_key:
        return jsonify(error='No TMDB API key configured'), 400

    names = library_names if library_names else ([library_name] if library_name else [])
    if not names:
        return jsonify(error='libraryName or libraryNames is required'), 400

    service = _get_service(source)

    if media_type == 'tv':
        gaps, error = _tv_gaps(tmdb, service, names, person_id, show_existing, include_minor,
                               include_imdb_ratings)
    else:
        gaps, error = _movie_gaps(tmdb, service, names, person_id, show_existing, include_minor)

    if error:
        return jsonify(error=error), 500

    actor = tmdb.get_person_details(person_id)
    return jsonify(gaps=gaps, actor=actor)


def _movie_gaps(tmdb, service, names, person_id, show_existing, include_minor):
    # Load any selected library that isn't cached yet so the user doesn't have
    # to "browse first". `movies_cache` returns a fresh snapshot on each access,
    # so read it *after* loading — otherwise newly loaded libraries are missing
    # from the snapshot and every movie would look un-owned.
    for name in names:
        if name not in service.movies_cache:
            service.get_movies(name)
    cache = service.movies_cache

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

    return tmdb.get_actor_gaps(
        person_id=person_id,
        owned_tmdb_ids=owned_ids,
        owned_movies=owned_movies,
        show_existing=show_existing,
        include_minor=include_minor,
    )


def _tv_gaps(tmdb, service, names, person_id, show_existing, include_minor,
             include_imdb_ratings=False):
    for name in names:
        if name not in service.shows_cache:
            service.get_shows(name)
    cache = service.shows_cache

    owned_shows = []
    owned_ids = set()
    seen_keys = set()
    for name in names:
        library_data = cache.get(name, {})
        for show in library_data.get('shows', []):
            key = show.get('tmdbId') or f"{show.get('name')}|{show.get('year')}"
            if key not in seen_keys:
                seen_keys.add(key)
                owned_shows.append(show)
            if show.get('tmdbId'):
                owned_ids.add(show['tmdbId'])

    gaps, error = tmdb.get_actor_tv_gaps(
        person_id=person_id,
        owned_tmdb_ids=owned_ids,
        owned_shows=owned_shows,
        show_existing=show_existing,
        include_minor=include_minor,
    )
    if error or not gaps:
        return gaps, error

    # Resolve TheTVDB + IMDb ids concurrently and persist newly-resolved ids (the
    # batch helper owns the concurrency cap + persist, shared with the movie path).
    # TheTVDB ids power Sonarr / ignore; IMDb ids power links + the ratings below.
    tmdb_ids = [g['tmdbId'] for g in gaps]
    externals = tmdb.get_tv_external_ids_batch(tmdb_ids)
    for gap, ext in zip(gaps, externals):
        gap['tvdbId'] = ext.get('tvdbId')
        gap['imdbId'] = ext.get('imdbId')

    # Attach IMDb ratings from the local dataset only when the client asked for
    # them (so we don't trigger a dataset build for users who don't want IMDb).
    if include_imdb_ratings:
        imdb_ids = [g['imdbId'] for g in gaps if g.get('imdbId')]
        ratings = current_app.imdb_service.get_ratings(imdb_ids)
        for gap in gaps:
            r = ratings.get(gap.get('imdbId'))
            if r:
                gap['imdbRating'] = r['aggregateRating']
                gap['imdbVotes'] = r['voteCount']

    return gaps, None
