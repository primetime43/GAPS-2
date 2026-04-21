import logging
from urllib.parse import quote
from plexapi.myplex import MyPlexPinLogin, MyPlexAccount
from plexapi.server import PlexServer
from app.services import config_store

logger = logging.getLogger(__name__)


class PlexService:

    def __init__(self):
        self._pin: MyPlexPinLogin | None = None
        self._token: str | None = None
        self._resources: dict = {}          # server_name -> connection info for dropdown
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

    def _timeout(self) -> int:
        prefs = config_store.get('preferences', {})
        return prefs.get('mediaServerTimeout', 30)

    def connect_manual(self, server_url: str, token: str) -> tuple[bool, str | None, list | None, str | None]:
        """Connect directly to a Plex server using URL and token."""
        try:
            server = PlexServer(server_url, token, timeout=self._timeout())
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

    def fetch_servers(self) -> tuple[list[str], str | None]:
        # Get token from OAuth pin or persisted state
        if self._pin and self._pin.token:
            self._token = self._pin.token
        if not self._token:
            return [], None

        # Clear stale connection so _get_server uses fresh credentials
        self._server_conn = None
        self._server_conn_name = None

        # Update active server token if it exists so _get_server uses the new token
        if self._active_server:
            self._active_server['token'] = self._token

        try:
            account = MyPlexAccount(token=self._token)
            resources = [r for r in account.resources()
                         if r.owned and r.connections and 'server' in r.provides]
            servers = [r.name for r in resources]
            # Store connection info for the connection URL dropdown
            self._resources = {}
            for r in resources:
                self._resources[r.name] = {
                    'connections': [
                        {'uri': c.uri, 'local': c.local}
                        for c in r.connections
                    ],
                }
            return servers, self._token
        except Exception as e:
            logger.warning("Failed to fetch servers via MyPlexAccount: %s", e)
            return [], None

    # -- Server connection (cached) --

    def _get_server(self, server_name: str) -> PlexServer | None:
        """Get a cached server connection, or connect if needed."""
        if self._server_conn and self._server_conn_name == server_name:
            return self._server_conn

        # Try direct URL from active server (manual connection)
        if self._active_server and self._active_server.get('serverUrl'):
            token = self._active_server.get('token', self._token)
            try:
                server = PlexServer(self._active_server['serverUrl'], token, timeout=self._timeout())
                self._server_conn = server
                self._server_conn_name = server_name
                return server
            except Exception as e:
                logger.warning("Failed to connect to Plex via stored URL: %s", e)

        # Fall back to MyPlexAccount discovery. plexapi tries all connection URIs
        # in parallel, so a short per-URI timeout caps the total wait — important
        # when running in environments (e.g. Docker) where plex.direct DNS names
        # don't resolve and several URIs are unreachable.
        if self._token:
            try:
                account = MyPlexAccount(token=self._token)
                server = account.resource(server_name).connect(timeout=8)
                self._server_conn = server
                self._server_conn_name = server_name
                working_url = getattr(server, '_baseurl', None)
                logger.info("Connected to Plex server '%s' via MyPlexAccount (%s)", server_name, working_url)
                # Cache the URL that actually worked so future connects skip discovery.
                if working_url and self._active_server and self._active_server.get('serverUrl') != working_url:
                    self._active_server['serverUrl'] = working_url
                    config_store.put('plex', {
                        'token': self._token,
                        'active_server': self._active_server,
                    })
                return server
            except Exception as e:
                logger.warning("MyPlexAccount connection to '%s' failed: %s", server_name, e)

        return None

    def get_connections(self, server_name: str) -> list[dict]:
        """Return available connection URLs for a server from the cached resources."""
        connections = []
        resource = self._resources.get(server_name)
        if not resource:
            return connections
        seen = set()
        for conn in resource.get('connections', []):
            url = conn.get('uri', '')
            if not url or url in seen:
                continue
            seen.add(url)
            is_local = conn.get('local', False)
            label = f"{'Local' if is_local else 'Remote'}: {url}"
            connections.append({'url': url, 'local': is_local, 'label': label})
        return connections

    # -- Connection testing --

    def test_active_connection(self) -> tuple[bool, str | None]:
        """Test if the active server is reachable."""
        if not self._active_server:
            return False, 'No active server'
        server_name = self._active_server['server']
        # Clear cached connection to force a fresh attempt
        self._server_conn = None
        self._server_conn_name = None
        server = self._get_server(server_name)
        if server is None:
            return False, 'Could not reach server'
        return True, server_name

    def refresh_connection(self) -> tuple[bool, str | None, list | None]:
        """Re-establish connection and refresh libraries."""
        if not self._active_server:
            return False, 'No active server', None
        server_name = self._active_server['server']
        # Clear cached connection
        self._server_conn = None
        self._server_conn_name = None
        self._movies_cache = {}
        server = self._get_server(server_name)
        if server is None:
            return False, 'Could not reach server', None
        try:
            libraries = [
                {'title': section.title, 'type': section.type}
                for section in server.library.sections()
            ]
            self._active_server['libraries'] = libraries
            config_store.put('plex', {
                'token': self._token,
                'active_server': self._active_server,
            })
            return True, None, libraries
        except Exception as e:
            return False, str(e), None

    # -- Libraries --

    def fetch_libraries(self, server_name: str) -> tuple[list | None, str | None, str | None]:
        server = self._get_server(server_name)

        if server is None:
            # Fall back to stored libraries if the server can't be reached
            if self._active_server and self._active_server.get('libraries'):
                logger.info("Using stored libraries for '%s' (server unreachable)", server_name)
                return self._active_server['libraries'], self._token, None
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
