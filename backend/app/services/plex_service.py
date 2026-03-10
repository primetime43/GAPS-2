from plexapi.myplex import MyPlexPinLogin, MyPlexAccount
from app.models.plex_account import PlexAccountData


class PlexService:
    def __init__(self):
        self._pin: MyPlexPinLogin | None = None
        self._token: str | None = None
        self._resources: dict = {}  # server_name -> MyPlexResource
        self._active_server = PlexAccountData()
        self._movies_cache: dict[str, dict] = {}

    # -- Auth --

    def authenticate(self) -> str:
        self._pin = MyPlexPinLogin(oauth=True)
        return self._pin.oauthUrl()

    def check_login(self) -> bool:
        return self._pin is not None and self._pin.checkLogin()

    # -- Servers --

    def fetch_servers(self) -> tuple[list[str], str | None]:
        if not self._pin or not self._pin.checkLogin():
            return [], None

        self._token = self._pin.token
        plex_account = MyPlexAccount(token=self._token)

        resources = [
            r for r in plex_account.resources()
            if r.owned and r.connections and r.provides == 'server'
        ]

        # Cache resources so we don't need to re-fetch from Plex API later
        self._resources = {}
        servers = []
        for r in resources:
            servers.append(r.name)
            self._resources[r.name] = r

        return servers, self._token

    # -- Libraries --

    def fetch_libraries(self, server_name: str) -> tuple[list[str] | None, str | None, str | None]:
        resource = self._resources.get(server_name)
        if resource is None:
            return None, None, 'Server not found'

        # connect() tries all connection URLs (remote first, then local)
        # so it works regardless of network location
        server = resource.connect()
        libraries = [
            {'title': section.title, 'type': section.type}
            for section in server.library.sections()
        ]

        return libraries, self._token, None

    # -- Active Server --

    def save_active_server(self, server: str, token: str, libraries: list | None = None) -> tuple[bool, str | None]:
        try:
            plex_data = PlexAccountData()
            plex_data.set_selected_server(server)
            plex_data.set_token(token)

            # Use already-fetched libraries passed from the frontend
            lib_list = libraries if isinstance(libraries, list) else []

            plex_data.set_libraries(lib_list)

            self._active_server.selected_server = server
            self._active_server.token = token
            self._active_server.libraries = lib_list

            return True, None
        except Exception as e:
            return False, str(e)

    def get_active_server(self) -> dict | None:
        if self._active_server and self._active_server.selected_server:
            return {
                'server': self._active_server.selected_server,
                'token': self._active_server.token,
                'libraries': self._active_server.libraries,
            }
        return None

    # -- Movies --

    def get_movies(self, library_name: str) -> tuple[list[dict] | None, str | None]:
        if library_name in self._movies_cache:
            return self._movies_cache[library_name]['movies'], None

        try:
            # Use cached resource if available, otherwise re-fetch
            server_name = self._active_server.selected_server
            resource = self._resources.get(server_name)

            if resource is None:
                # Fallback: re-fetch resources if cache was lost (e.g. server restart)
                plex_account = MyPlexAccount(token=self._active_server.token)
                for r in plex_account.resources():
                    if r.owned and r.name == server_name:
                        resource = r
                        break

            if resource is None:
                return None, 'Server resource not found'

            server = resource.connect()
            library = server.library.section(library_name)
            movies = library.search(libtype='movie')

            movie_data = []
            tmdb_ids = []

            for movie in movies:
                imdb_id = None
                tmdb_id = None
                tvdb_id = None

                for guid in movie.guids:
                    if 'imdb' in guid.id:
                        imdb_id = guid.id.replace('imdb://', '')
                    elif 'tmdb' in guid.id:
                        tmdb_id = int(guid.id.replace('tmdb://', ''))
                    elif 'tvdb' in guid.id:
                        tvdb_id = guid.id.replace('tvdb://', '')

                movie_data.append({
                    'name': movie.title,
                    'year': movie.year,
                    'overview': movie.summary,
                    'posterUrl': movie.posterUrl,
                    'imdbId': imdb_id,
                    'tmdbId': tmdb_id,
                    'tvdbId': tvdb_id,
                })
                if tmdb_id:
                    tmdb_ids.append(tmdb_id)

            self._movies_cache[library_name] = {
                'movies': movie_data,
                'tmdbIds': tmdb_ids,
            }

            return movie_data, None

        except Exception as e:
            return None, str(e)

    @property
    def movies_cache(self) -> dict:
        return self._movies_cache
