import logging
import requests
from app.services import config_store

logger = logging.getLogger(__name__)


class EmbyService:
    """Emby media server integration."""

    def __init__(self):
        self._server_url: str | None = None
        self._api_key: str | None = None
        self._user_id: str | None = None
        self._active_server: dict | None = None
        self._movies_cache: dict[str, dict] = {}

        # Restore persisted state
        saved = config_store.get('emby', {})
        if saved.get('server_url'):
            self._server_url = saved['server_url']
            self._api_key = saved.get('api_key')
            self._user_id = saved.get('user_id')
            self._active_server = saved.get('active_server')

    def _headers(self) -> dict:
        return {'X-Emby-Token': self._api_key}

    def _base(self) -> str:
        return self._server_url.rstrip('/')

    # -- Connection --

    def test_connection(self, server_url: str, api_key: str) -> tuple[bool, str | None]:
        """Test connection to an Emby server."""
        try:
            url = f"{server_url.rstrip('/')}/System/Info"
            resp = requests.get(url, headers={'X-Emby-Token': api_key}, timeout=10)
            if resp.status_code == 200:
                info = resp.json()
                return True, info.get('ServerName', 'Emby Server')
            return False, None
        except Exception as e:
            logger.warning("Emby connection test failed for %s: %s", server_url, e)
            return False, None

    def connect(self, server_url: str, api_key: str) -> tuple[bool, str | None, str | None]:
        """Connect and discover user ID."""
        ok, server_name = self.test_connection(server_url, api_key)
        if not ok:
            return False, None, 'Could not connect to Emby server'

        self._server_url = server_url.rstrip('/')
        self._api_key = api_key

        # Get first admin user ID
        try:
            resp = requests.get(
                f"{self._base()}/Users",
                headers=self._headers(),
                timeout=10,
            )
            if resp.status_code == 200:
                users = resp.json()
                if users:
                    self._user_id = users[0]['Id']
        except Exception as e:
            logger.warning("Failed to discover Emby user ID: %s", e)

        return True, server_name, None

    # -- Libraries --

    def fetch_libraries(self) -> tuple[list | None, str | None]:
        if not self._server_url or not self._api_key:
            return None, 'Not connected'

        try:
            if self._user_id:
                url = f"{self._base()}/Users/{self._user_id}/Views"
            else:
                url = f"{self._base()}/Library/VirtualFolders"

            resp = requests.get(url, headers=self._headers(), timeout=10)
            if resp.status_code != 200:
                return None, f'Failed to fetch libraries (HTTP {resp.status_code})'

            data = resp.json()
            items = data.get('Items', data) if isinstance(data, dict) else data

            libraries = []
            for item in items:
                coll_type = item.get('CollectionType', item.get('collectionType', ''))
                lib_type = 'movie' if coll_type == 'movies' else coll_type or 'unknown'
                libraries.append({
                    'title': item.get('Name', item.get('name', '')),
                    'type': lib_type,
                    'id': item.get('Id', item.get('ItemId', '')),
                })

            return libraries, None
        except Exception as e:
            return None, str(e)

    def test_active_connection(self) -> tuple[bool, str | None]:
        """Test if the active server is reachable."""
        if not self._server_url or not self._api_key:
            return False, 'Not connected'
        return self.test_connection(self._server_url, self._api_key)

    def refresh_connection(self) -> tuple[bool, str | None, list | None]:
        """Re-test connection and refresh libraries."""
        if not self._server_url or not self._api_key:
            return False, 'Not connected', None
        ok, server_name = self.test_connection(self._server_url, self._api_key)
        if not ok:
            return False, 'Could not reach server', None
        self._movies_cache = {}
        libs, err = self.fetch_libraries()
        if err:
            return False, err, None
        if self._active_server:
            self._active_server['libraries'] = libs
            config_store.put('emby', {
                'server_url': self._server_url,
                'api_key': self._api_key,
                'user_id': self._user_id,
                'active_server': self._active_server,
            })
        return True, None, libs

    # -- Active Server --

    def save_active_server(self, server_url: str, api_key: str, server_name: str, libraries: list | None = None) -> None:
        self._server_url = server_url.rstrip('/')
        self._api_key = api_key
        self._active_server = {
            'server': server_name,
            'server_url': server_url,
            'libraries': libraries if isinstance(libraries, list) else [],
        }
        config_store.put('emby', {
            'server_url': self._server_url,
            'api_key': api_key,
            'user_id': self._user_id,
            'active_server': self._active_server,
        })

    def get_active_server(self) -> dict | None:
        return self._active_server

    def remove_active_server(self) -> None:
        self._active_server = None
        self._server_url = None
        self._api_key = None
        self._user_id = None
        self._movies_cache = {}
        config_store.remove('emby')

    # -- Movies --

    def get_movies(self, library_name: str) -> tuple[list[dict] | None, str | None]:
        if library_name in self._movies_cache:
            return self._movies_cache[library_name]['movies'], None

        if not self._server_url or not self._api_key:
            return None, 'Not connected'

        # Find the library ID by name
        libs, err = self.fetch_libraries()
        if err:
            return None, err

        library_id = None
        for lib in (libs or []):
            if lib['title'] == library_name:
                library_id = lib.get('id')
                break

        if not library_id:
            return None, f'Library "{library_name}" not found'

        try:
            params = {
                'IncludeItemTypes': 'Movie',
                'Fields': 'ProviderIds,Overview',
                'Recursive': 'true',
                'Limit': '10000',
            }
            if library_id:
                params['ParentId'] = library_id

            if self._user_id:
                url = f"{self._base()}/Users/{self._user_id}/Items"
            else:
                url = f"{self._base()}/Items"

            resp = requests.get(url, headers=self._headers(), params=params, timeout=30)
            if resp.status_code != 200:
                return None, f'Failed to fetch movies (HTTP {resp.status_code})'

            data = resp.json()
            items = data.get('Items', [])

            movie_data = []
            tmdb_ids = []

            for item in items:
                provider_ids = item.get('ProviderIds', {})
                imdb_id = provider_ids.get('Imdb')
                tmdb_id = None
                tvdb_id = provider_ids.get('Tvdb')

                tmdb_str = provider_ids.get('Tmdb')
                if tmdb_str:
                    try:
                        tmdb_id = int(tmdb_str)
                    except ValueError:
                        pass

                poster_url = None
                if item.get('ImageTags', {}).get('Primary'):
                    poster_url = f"/api/libraries/image-proxy?source=emby&itemId={item['Id']}"

                year = item.get('ProductionYear')

                movie_data.append({
                    'name': item.get('Name', ''),
                    'year': year,
                    'overview': item.get('Overview', ''),
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
