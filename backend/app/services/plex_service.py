from urllib.parse import quote
from plexapi.myplex import MyPlexPinLogin
from plexapi.server import PlexServer
from plexapi import BASE_HEADERS
import requests
from app.services import config_store


class PlexService:
    RESOURCES_URL = 'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1'

    def __init__(self):
        self._pin: MyPlexPinLogin | None = None
        self._token: str | None = None
        self._resources: dict = {}          # server_name -> raw JSON from plex.tv
        self._server_conn: PlexServer | None = None
        self._server_conn_name: str | None = None
        self._active_server: dict | None = None
        self._movies_cache: dict[str, dict] = {}

        # Restore persisted state
        saved = config_store.get('plex', {})
        if saved.get('token'):
            self._token = saved['token']
        if saved.get('active_server'):
            self._active_server = saved['active_server']

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

    # -- Manual connection --

    def connect_manual(self, server_url: str, token: str) -> tuple[bool, str | None, list | None, str | None]:
        """Connect directly to a Plex server using URL and token."""
        try:
            server = PlexServer(server_url, token, timeout=5)
            self._server_conn = server
            self._server_conn_name = server.friendlyName
            self._token = token
            libraries = [
                {'title': section.title, 'type': section.type}
                for section in server.library.sections()
            ]
            return True, server.friendlyName, libraries, None
        except Exception as e:
            return False, None, None, str(e)

    # -- Servers --

    def _fetch_resources(self) -> list[dict]:
        """Fetch resources JSON directly from Plex.tv (single API call)."""
        headers = {**BASE_HEADERS, 'Accept': 'application/json', 'X-Plex-Token': self._token}
        resp = requests.get(self.RESOURCES_URL, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def fetch_servers(self) -> tuple[list[str], str | None]:
        # Get token from OAuth pin or persisted state
        if self._pin and self._pin.token:
            self._token = self._pin.token
        if not self._token:
            return [], None

        resources_json = self._fetch_resources()

        self._resources = {}
        servers = []
        for r in resources_json:
            if r.get('owned') and r.get('connections') and 'server' in r.get('provides', ''):
                name = r['name']
                servers.append(name)
                self._resources[name] = r

        return servers, self._token

    # -- Server connection (cached) --

    def _get_server(self, server_name: str) -> PlexServer | None:
        """Get a cached server connection, or connect if needed."""
        if self._server_conn and self._server_conn_name == server_name:
            return self._server_conn

        # Try direct URL from active server (manual connection)
        if self._active_server and self._active_server.get('serverUrl'):
            token = self._active_server.get('token', self._token)
            try:
                server = PlexServer(self._active_server['serverUrl'], token, timeout=5)
                self._server_conn = server
                self._server_conn_name = server_name
                return server
            except Exception:
                pass

        resource = self._resources.get(server_name)
        if resource is None:
            # Try re-fetching resources if cache is empty
            if self._token:
                try:
                    resources_json = self._fetch_resources()
                    for r in resources_json:
                        if r.get('owned') and r.get('name') == server_name:
                            resource = r
                            self._resources[server_name] = r
                            break
                except Exception:
                    pass
            if resource is None:
                return None

        # Connect directly using connection URLs from the JSON.
        # Try HTTPS connections first, then HTTP. Prioritize local, then remote.
        token = resource.get('accessToken', self._token)
        connections = resource.get('connections', [])

        # Sort: local first, then remote; HTTPS preferred
        def conn_priority(c):
            is_local = c.get('local', False)
            is_https = c.get('protocol', '') == 'https'
            return (not is_local, not is_https)

        connections.sort(key=conn_priority)

        for conn in connections:
            url = conn.get('uri')
            if not url:
                continue
            try:
                server = PlexServer(url, token, timeout=5)
                self._server_conn = server
                self._server_conn_name = server_name
                return server
            except Exception:
                continue

        return None

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

    def save_active_server(self, server: str, token: str, libraries: list | None = None, server_url: str | None = None) -> tuple[bool, str | None]:
        self._active_server = {
            'server': server,
            'token': token,
            'libraries': libraries if isinstance(libraries, list) else [],
        }
        if server_url:
            self._active_server['serverUrl'] = server_url
        self._token = token
        config_store.put('plex', {
            'token': token,
            'active_server': self._active_server,
        })
        return True, None

    def get_active_server(self) -> dict | None:
        if self._active_server:
            return self._active_server
        return None

    def remove_active_server(self) -> None:
        self._active_server = None
        self._server_conn = None
        self._server_conn_name = None
        self._movies_cache = {}
        config_store.remove('plex')

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
            movies = library.search(libtype='movie', includeGuids=True)

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

                poster_url = None
                if movie.thumb:
                    poster_url = f"/api/libraries/image-proxy?source=plex&thumb={quote(movie.thumb, safe='')}"

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
