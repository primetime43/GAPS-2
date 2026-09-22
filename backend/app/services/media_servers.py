"""Single source of truth for mapping a `source` name to its media-server service.

Both request handlers (via `current_app`) and the scheduler (via its stored app
reference) resolve the Plex/Jellyfin/Emby service through here, so adding a new
server type is a one-line change instead of editing every blueprint.
"""


def media_service_for(app, source: str):
    """Return the media-server service on `app` for the given source name.

    `app` may be a real Flask app or `current_app` (a proxy) — both expose the
    `*_service` attributes. Unknown sources fall back to Plex.
    """
    if source == 'jellyfin':
        return app.jellyfin_service
    if source == 'emby':
        return app.emby_service
    return app.plex_service


def load_library_cache(service, names: list[str], media_type: str, refresh: bool = False):
    """Load every selected library before deriving ownership; never use partial data."""
    cache_name = 'shows_cache' if media_type == 'tv' else 'movies_cache'
    fetch = service.get_shows if media_type == 'tv' else service.get_movies
    if refresh:
        clear = service.clear_shows_cache if media_type == 'tv' else service.clear_movies_cache
        clear()
    for name in dict.fromkeys(names):
        if name not in getattr(service, cache_name):
            _, error = fetch(name)
            if error:
                return None, f'Could not load library "{name}": {error}'
    return getattr(service, cache_name), None
