import logging
import time
import requests
from app.services import config_store

logger = logging.getLogger(__name__)

CONFIG_KEY = 'sonarr'
DEFAULT_TIMEOUT = 10
# Add can legitimately take longer than a normal read (metadata fetch, disk
# scaffolding) so allow a bigger window before we fall back to verification.
ADD_TIMEOUT = 30
# After a POST timeout, Sonarr may still be processing — re-check the library
# a few times before declaring failure.
VERIFY_ATTEMPTS = 3
VERIFY_INTERVAL_SECONDS = 2


def _normalize_url(url: str) -> str:
    """Strip trailing slashes and /api suffix variants."""
    url = (url or '').strip().rstrip('/')
    if url.endswith('/api/v3'):
        url = url[:-len('/api/v3')]
    elif url.endswith('/api'):
        url = url[:-len('/api')]
    return url


class SonarrService:
    """Thin wrapper around the Sonarr v4 API (TV analogue of RadarrService).

    Sonarr v4 still serves its API under the /api/v3 path but dropped language
    profiles, so there is no languageProfileId handling here.
    """

    def get_config(self) -> dict:
        saved = config_store.get(CONFIG_KEY, {}) or {}
        return {
            'enabled': bool(saved.get('url') and saved.get('api_key')),
            'url': saved.get('url', ''),
            'api_key': saved.get('api_key', ''),
            'quality_profile_id': saved.get('quality_profile_id', 0),
            'root_folder_path': saved.get('root_folder_path', ''),
            'monitored': saved.get('monitored', True),
            'season_folder': saved.get('season_folder', True),
            'search_on_add': saved.get('search_on_add', True),
        }

    def save_config(self, data: dict) -> dict:
        cleaned = {
            'url': _normalize_url(data.get('url', '')),
            'api_key': (data.get('api_key') or '').strip(),
            'quality_profile_id': int(data.get('quality_profile_id') or 0),
            'root_folder_path': (data.get('root_folder_path') or '').strip(),
            'monitored': bool(data.get('monitored', True)),
            'season_folder': bool(data.get('season_folder', True)),
            'search_on_add': bool(data.get('search_on_add', True)),
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
            # Sonarr v4 still exposes its API under /api/v3.
            resp = self._request('GET', f'{url}/api/v3/system/status', api_key)
            if resp.status_code == 200:
                data = resp.json()
                version = data.get('version', '?')
                return True, f'Connected to Sonarr {version}'
            if resp.status_code == 401:
                return False, 'Invalid API key'
            return False, f'Sonarr returned HTTP {resp.status_code}'
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

    def get_library_tvdb_ids(self) -> list[int]:
        """Return the TheTVDB ids of every series already in the Sonarr library."""
        creds = self._get_url_key()
        if not creds:
            return []
        url, api_key = creds
        resp = self._request('GET', f'{url}/api/v3/series', api_key)
        resp.raise_for_status()
        ids = []
        for s in resp.json():
            tvdb_id = s.get('tvdbId')
            if isinstance(tvdb_id, int) and tvdb_id > 0:
                ids.append(tvdb_id)
        return ids

    def _series_in_library(self, tvdb_id: int) -> bool:
        """Quick library probe used to confirm an add after a POST timeout."""
        try:
            return tvdb_id in self.get_library_tvdb_ids()
        except requests.exceptions.RequestException:
            return False

    def _wait_until_added(self, tvdb_id: int) -> bool:
        """Poll the library a few times to see whether Sonarr finished the add."""
        for _ in range(VERIFY_ATTEMPTS):
            if self._series_in_library(tvdb_id):
                return True
            time.sleep(VERIFY_INTERVAL_SECONDS)
        return False

    def add_series(self, tvdb_id: int, title: str = '') -> tuple[bool, str]:
        """Add a series to Sonarr by TheTVDB id.

        Returns (success, message). Treats "already added" responses as success.
        """
        creds = self._get_url_key()
        if not creds:
            return False, 'Sonarr is not configured'
        url, api_key = creds

        cfg = self.get_config()
        if not cfg['quality_profile_id'] or not cfg['root_folder_path']:
            return False, 'Quality profile and root folder must be configured first'

        # Look up series metadata from Sonarr's TheTVDB proxy so the payload
        # includes images/seasons/titleSlug.
        try:
            lookup = self._request(
                'GET',
                f'{url}/api/v3/series/lookup',
                api_key,
                params={'term': f'tvdb:{tvdb_id}'},
            )
            if lookup.status_code != 200:
                return False, f'Sonarr lookup failed (HTTP {lookup.status_code})'
            results = lookup.json()
            series = results[0] if isinstance(results, list) and results else (results or {})
            if not series:
                return False, 'Series not found in TheTVDB'
        except requests.exceptions.RequestException as e:
            return False, f'Sonarr lookup error: {e}'

        payload = {
            'tvdbId': tvdb_id,
            'title': series.get('title') or title,
            'titleSlug': series.get('titleSlug'),
            'images': series.get('images', []),
            'seasons': series.get('seasons', []),
            'qualityProfileId': cfg['quality_profile_id'],
            'rootFolderPath': cfg['root_folder_path'],
            'monitored': cfg['monitored'],
            'seasonFolder': cfg['season_folder'],
            'addOptions': {
                'searchForMissingEpisodes': cfg['search_on_add'],
                'monitor': 'all' if cfg['monitored'] else 'none',
            },
        }

        try:
            resp = self._request(
                'POST', f'{url}/api/v3/series', api_key, json=payload, timeout=ADD_TIMEOUT,
            )
        except requests.exceptions.Timeout:
            # Sonarr is slow but probably still processing — confirm via the library.
            logger.warning(
                "Sonarr POST /series timed out for tvdb=%s; verifying via library", tvdb_id,
            )
            if self._wait_until_added(tvdb_id):
                return True, f'Added "{payload["title"]}" to Sonarr (confirmed after slow response)'
            return False, 'Sonarr did not respond in time; the series is not yet in the library'
        except requests.exceptions.RequestException as e:
            return False, f'Sonarr request failed: {e}'

        if resp.status_code in (200, 201):
            return True, f'Added "{payload["title"]}" to Sonarr'

        if resp.status_code == 400:
            try:
                errors = resp.json()
            except ValueError:
                errors = []
            if isinstance(errors, list):
                messages = [e.get('errorMessage', '') for e in errors if isinstance(e, dict)]
                joined = '; '.join(m for m in messages if m)
                if any('already' in m.lower() for m in messages):
                    return True, f'"{payload["title"]}" is already in Sonarr'
                if joined:
                    return False, joined
            return False, 'Sonarr rejected the request (HTTP 400)'

        if resp.status_code == 401:
            return False, 'Invalid Sonarr API key'

        return False, f'Sonarr returned HTTP {resp.status_code}'
