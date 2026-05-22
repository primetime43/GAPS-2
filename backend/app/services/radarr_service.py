import logging
import requests
from app.services import config_store

logger = logging.getLogger(__name__)

CONFIG_KEY = 'radarr'
DEFAULT_TIMEOUT = 10


def _normalize_url(url: str) -> str:
    """Strip trailing slashes and /api suffix variants."""
    url = (url or '').strip().rstrip('/')
    if url.endswith('/api/v3'):
        url = url[:-len('/api/v3')]
    elif url.endswith('/api'):
        url = url[:-len('/api')]
    return url


class RadarrService:
    """Thin wrapper around the Radarr v3 API."""

    def get_config(self) -> dict:
        saved = config_store.get(CONFIG_KEY, {}) or {}
        return {
            'enabled': bool(saved.get('url') and saved.get('api_key')),
            'url': saved.get('url', ''),
            'api_key': saved.get('api_key', ''),
            'quality_profile_id': saved.get('quality_profile_id', 0),
            'root_folder_path': saved.get('root_folder_path', ''),
            'minimum_availability': saved.get('minimum_availability', 'released'),
            'monitored': saved.get('monitored', True),
            'search_on_add': saved.get('search_on_add', True),
            'auto_route_by_decade': saved.get('auto_route_by_decade', False),
        }

    def save_config(self, data: dict) -> dict:
        cleaned = {
            'url': _normalize_url(data.get('url', '')),
            'api_key': (data.get('api_key') or '').strip(),
            'quality_profile_id': int(data.get('quality_profile_id') or 0),
            'root_folder_path': (data.get('root_folder_path') or '').strip(),
            'minimum_availability': (data.get('minimum_availability') or 'released').strip(),
            'monitored': bool(data.get('monitored', True)),
            'search_on_add': bool(data.get('search_on_add', True)),
            'auto_route_by_decade': bool(data.get('auto_route_by_decade', False)),
        }
        config_store.put(CONFIG_KEY, cleaned)
        return self.get_config()

    def clear_config(self) -> None:
        config_store.remove(CONFIG_KEY)

    @staticmethod
    def _request(method: str, url: str, api_key: str, **kwargs) -> requests.Response:
        headers = kwargs.pop('headers', {}) or {}
        headers['X-Api-Key'] = api_key
        timeout = kwargs.pop('timeout', DEFAULT_TIMEOUT)
        return requests.request(method, url, headers=headers, timeout=timeout, **kwargs)

    def test_connection(self, url: str, api_key: str) -> tuple[bool, str]:
        url = _normalize_url(url)
        if not url or not api_key:
            return False, 'URL and API key are required'
        try:
            resp = self._request('GET', f'{url}/api/v3/system/status', api_key)
            if resp.status_code == 200:
                data = resp.json()
                version = data.get('version', '?')
                return True, f'Connected to Radarr {version}'
            if resp.status_code == 401:
                return False, 'Invalid API key'
            return False, f'Radarr returned HTTP {resp.status_code}'
        except requests.exceptions.RequestException as e:
            return False, f'Connection failed: {e}'

    def _get_url_key(self) -> tuple[str, str] | None:
        cfg = config_store.get(CONFIG_KEY, {}) or {}
        url = cfg.get('url')
        api_key = cfg.get('api_key')
        if not url or not api_key:
            return None
        return url, api_key

    def get_quality_profiles(self) -> list[dict]:
        creds = self._get_url_key()
        if not creds:
            return []
        url, api_key = creds
        resp = self._request('GET', f'{url}/api/v3/qualityprofile', api_key)
        resp.raise_for_status()
        return [{'id': p['id'], 'name': p['name']} for p in resp.json()]

    def get_root_folders(self) -> list[dict]:
        creds = self._get_url_key()
        if not creds:
            return []
        url, api_key = creds
        resp = self._request('GET', f'{url}/api/v3/rootfolder', api_key)
        resp.raise_for_status()
        return [
            {
                'path': f['path'],
                'free_space': f.get('freeSpace', 0),
                'accessible': f.get('accessible', True),
            }
            for f in resp.json()
        ]

    def get_library_tmdb_ids(self) -> list[int]:
        """Return the TMDB ids of every movie already in the Radarr library."""
        creds = self._get_url_key()
        if not creds:
            return []
        url, api_key = creds
        resp = self._request('GET', f'{url}/api/v3/movie', api_key)
        resp.raise_for_status()
        ids = []
        for m in resp.json():
            tmdb_id = m.get('tmdbId')
            if isinstance(tmdb_id, int) and tmdb_id > 0:
                ids.append(tmdb_id)
        return ids

    def _resolve_root_folder(self, year: int, url: str, api_key: str, default_path: str) -> str:
        """Pick a root folder whose path matches the movie's decade (e.g. 2021 -> /movies/2020s).

        Falls back to default_path when no folder matches or the lookup fails.
        """
        if not isinstance(year, int) or year <= 0:
            return default_path
        decade = (year // 10) * 10
        try:
            resp = self._request('GET', f'{url}/api/v3/rootfolder', api_key)
            resp.raise_for_status()
            paths = [f['path'] for f in resp.json() if f.get('path')]
        except (requests.exceptions.RequestException, ValueError, KeyError):
            return default_path
        # Prefer a "2020s" style match, then a bare "2020" match.
        for needle in (f'{decade}s', str(decade)):
            for path in paths:
                if needle in path:
                    return path
        return default_path

    def add_movie(self, tmdb_id: int, title: str = '', year: int = 0) -> tuple[bool, str]:
        """Add a movie to Radarr by TMDB id.

        Returns (success, message). Treats "already added" responses as success.
        """
        creds = self._get_url_key()
        if not creds:
            return False, 'Radarr is not configured'
        url, api_key = creds

        cfg = self.get_config()
        if not cfg['quality_profile_id'] or not cfg['root_folder_path']:
            return False, 'Quality profile and root folder must be configured first'

        # Look up movie metadata from Radarr's TMDB proxy so payload includes images/year.
        try:
            lookup = self._request(
                'GET',
                f'{url}/api/v3/movie/lookup/tmdb',
                api_key,
                params={'tmdbId': tmdb_id},
            )
            if lookup.status_code != 200:
                return False, f'Radarr lookup failed (HTTP {lookup.status_code})'
            movie = lookup.json()
            if isinstance(movie, list):
                movie = movie[0] if movie else {}
            if not movie:
                return False, 'Movie not found in TMDB'
        except requests.exceptions.RequestException as e:
            return False, f'Radarr lookup error: {e}'

        movie_year = movie.get('year') or year
        root_folder_path = cfg['root_folder_path']
        if cfg['auto_route_by_decade']:
            root_folder_path = self._resolve_root_folder(
                movie_year, url, api_key, cfg['root_folder_path']
            )

        payload = {
            'tmdbId': tmdb_id,
            'title': movie.get('title') or title,
            'year': movie_year,
            'titleSlug': movie.get('titleSlug'),
            'images': movie.get('images', []),
            'qualityProfileId': cfg['quality_profile_id'],
            'rootFolderPath': root_folder_path,
            'minimumAvailability': cfg['minimum_availability'],
            'monitored': cfg['monitored'],
            'addOptions': {
                'searchForMovie': cfg['search_on_add'],
                'monitor': 'movieOnly' if cfg['monitored'] else 'none',
            },
        }

        try:
            resp = self._request('POST', f'{url}/api/v3/movie', api_key, json=payload)
        except requests.exceptions.RequestException as e:
            return False, f'Radarr request failed: {e}'

        if resp.status_code in (200, 201):
            return True, f'Added "{payload["title"]}" to Radarr ({root_folder_path})'

        # Radarr returns 400 with a list of error dicts when the movie already exists.
        if resp.status_code == 400:
            try:
                errors = resp.json()
            except ValueError:
                errors = []
            if isinstance(errors, list):
                messages = [e.get('errorMessage', '') for e in errors if isinstance(e, dict)]
                joined = '; '.join(m for m in messages if m)
                if any('already' in m.lower() for m in messages):
                    return True, f'"{payload["title"]}" is already in Radarr'
                if joined:
                    return False, joined
            return False, 'Radarr rejected the request (HTTP 400)'

        if resp.status_code == 401:
            return False, 'Invalid Radarr API key'

        return False, f'Radarr returned HTTP {resp.status_code}'
