from plexapi.myplex import MyPlexPinLogin, MyPlexAccount
from app.models.plex_account import PlexAccountData


class PlexService:
    def __init__(self):
        self._pin: MyPlexPinLogin | None = None
        self._plex_accounts: list[PlexAccountData] = []
        self._stored_libraries: dict[str, list[str]] = {}
        self._stored_plex_accounts: dict[str, PlexAccountData] = {}
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

        plex_data = PlexAccountData()
        plex_account = MyPlexAccount(token=self._pin.token)

        resources = [
            r for r in plex_account.resources()
            if r.owned and r.connections and r.provides == 'server'
        ]

        servers = [f"{r.name} ({r.connections[0].address})" for r in resources]

        for resource in resources:
            server_name = f"{resource.name} ({resource.connections[0].address})"
            plex_data.add_token(server_name, self._pin.token)

        plex_data.set_servers(servers)
        self._plex_accounts.append(plex_data)

        return servers, self._pin.token

    # -- Libraries --

    def fetch_libraries(self, server_name: str) -> tuple[list[str] | None, str | None, str | None]:
        plex_data = next(
            (d for d in self._plex_accounts if server_name in d.tokens), None
        )
        if plex_data is None:
            return None, None, 'PlexAccountData not found'

        token = plex_data.tokens.get(server_name)
        plex_account = MyPlexAccount(token=token)

        server = None
        for resource in plex_account.resources():
            if f"{resource.name} ({resource.connections[0].address})" == server_name:
                server = resource.connect()
                break

        if server is None:
            return None, None, 'Server not found'

        libraries = [section.title for section in server.library.sections()]
        plex_data.set_libraries(libraries)
        self._stored_libraries[server_name] = libraries

        return libraries, token, None

    # -- Active Server --

    def save_active_server(self, server: str, token: str) -> tuple[bool, str | None]:
        try:
            plex_data = PlexAccountData()
            plex_data.set_selected_server(server)
            plex_data.set_token(token)

            libraries, _, error = self.fetch_libraries(server)
            if error:
                return False, error

            plex_data.set_libraries(self._stored_libraries)
            self._stored_plex_accounts[server] = plex_data

            self._active_server.selected_server = server
            self._active_server.token = token
            self._active_server.libraries = self._stored_libraries

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
            plex_account = MyPlexAccount(token=self._active_server.token)

            server_resource = None
            for resource in plex_account.resources():
                if resource.owned:
                    name = f"{resource.name} ({resource.connections[0].address})"
                    if name == self._active_server.selected_server:
                        server_resource = resource
                        break

            if server_resource is None:
                return None, 'Server resource not found'

            server = server_resource.connect()
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
