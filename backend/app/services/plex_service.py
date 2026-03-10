from plexapi.myplex import MyPlexPinLogin, MyPlexAccount, MyPlexResource
from plexapi.server import PlexServer
from plexapi import BASE_HEADERS
import requests


class PlexService:
    RESOURCES_URL = 'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1'

    def __init__(self):
        self._pin: MyPlexPinLogin | None = None
        self._token: str | None = None
        self._account: MyPlexAccount | None = None
        self._resources: dict = {}          # server_name -> MyPlexResource
        self._server_conn: PlexServer | None = None  # cached server connection
        self._server_conn_name: str | None = None
        self._active_server: dict | None = None
        self._movies_cache: dict[str, dict] = {}

    # -- Auth --

    def authenticate(self) -> str:
        self._pin = MyPlexPinLogin(oauth=True)
        return self._pin.oauthUrl()

    def check_login(self) -> bool:
        if self._pin is None:
            return False
        if self._pin.token:
            return True
        return self._pin.checkLogin()

    # -- Account (lazy, cached) --

    def _get_account(self) -> MyPlexAccount:
        """Get or create a cached MyPlexAccount. Reused across calls that need it."""
        if self._account is None or self._account._token != self._token:
            self._account = MyPlexAccount(token=self._token)
        return self._account

    # -- Servers --

    def fetch_servers(self) -> tuple[list[str], str | None]:
        if not self._pin or not self._pin.token:
            return [], None

        self._token = self._pin.token

        # Fetch resources directly from Plex.tv, skipping the full account sign-in
        headers = {**BASE_HEADERS, 'Accept': 'application/json', 'X-Plex-Token': self._token}
        resp = requests.get(self.RESOURCES_URL, headers=headers, timeout=10)
        resp.raise_for_status()
        resources_json = resp.json()

        # Build MyPlexResource objects so connect() works later.
        # We need a MyPlexAccount for that, but we can defer it to when
        # the user actually selects a server and needs to connect.
        self._resources = {}
        servers = []
        for r in resources_json:
            if r.get('owned') and r.get('connections') and 'server' in r.get('provides', ''):
                name = r['name']
                servers.append(name)
                # Store raw JSON for deferred connection
                self._resources[name] = r

        return servers, self._token

    # -- Server connection (cached) --

    def _get_server(self, server_name: str) -> PlexServer | None:
        """Get a cached server connection, or connect if needed."""
        if self._server_conn and self._server_conn_name == server_name:
            return self._server_conn

        resource_data = self._resources.get(server_name)
        if resource_data is None:
            return None

        # If we have raw JSON, convert to MyPlexResource via the account
        if isinstance(resource_data, dict):
            account = self._get_account()
            # Re-fetch resources through the account to get proper MyPlexResource objects
            for r in account.resources():
                if r.owned and r.name == server_name:
                    resource_data = r
                    self._resources[server_name] = r
                    break
            else:
                return None

        self._server_conn = resource_data.connect()
        self._server_conn_name = server_name
        return self._server_conn

    # -- Libraries --

    def fetch_libraries(self, server_name: str) -> tuple[list | None, str | None, str | None]:
        server = self._get_server(server_name)
        if server is None:
            return None, None, 'Server not found'

        libraries = [
            {'title': section.title, 'type': section.type}
            for section in server.library.sections()
        ]

        return libraries, self._token, None

    # -- Active Server --

    def save_active_server(self, server: str, token: str, libraries: list | None = None) -> tuple[bool, str | None]:
        self._active_server = {
            'server': server,
            'token': token,
            'libraries': libraries if isinstance(libraries, list) else [],
        }
        self._token = token
        return True, None

    def get_active_server(self) -> dict | None:
        if self._active_server:
            return self._active_server
        return None

    # -- Movies --

    def get_movies(self, library_name: str) -> tuple[list[dict] | None, str | None]:
        if library_name in self._movies_cache:
            return self._movies_cache[library_name]['movies'], None

        if not self._active_server:
            return None, 'No active server'

        server_name = self._active_server['server']
        server = self._get_server(server_name)
        if server is None:
            return None, 'Server not found'

        try:
            library = server.library.section(library_name)
            # Fetch all movies with guids included to avoid N+1 lazy loads
            movies = library.search(libtype='movie', includeGuids=True)

            base_url = server._baseurl
            token = self._active_server['token']

            movie_data = []
            tmdb_ids = []

            for movie in movies:
                imdb_id = None
                tmdb_id = None
                tvdb_id = None

                if hasattr(movie, 'guids') and movie.guids:
                    for guid in movie.guids:
                        gid = guid.id
                        if gid.startswith('imdb://'):
                            imdb_id = gid[7:]
                        elif gid.startswith('tmdb://'):
                            try:
                                tmdb_id = int(gid[7:])
                            except ValueError:
                                pass
                        elif gid.startswith('tvdb://'):
                            tvdb_id = gid[7:]

                # Build poster URL directly instead of using movie.posterUrl
                # which makes a network request per movie
                poster_url = None
                if movie.thumb:
                    poster_url = f"{base_url}{movie.thumb}?X-Plex-Token={token}"

                movie_data.append({
                    'name': movie.title,
                    'year': movie.year,
                    'overview': getattr(movie, 'summary', ''),
                    'posterUrl': poster_url,
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
