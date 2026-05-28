import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import requests

from app.services import config_store, scan_history

logger = logging.getLogger(__name__)

# Parallel TheTVDB lookups during a scan. Each owned series and each franchise
# member needs its own /series/{id}/extended call; fetching them concurrently
# turns a multi-minute serial crawl into seconds. Kept modest to stay friendly
# to TheTVDB's rate limits.
_SCAN_WORKERS = 8

CONFIG_KEY = 'tvdb'
DEFAULT_TIMEOUT = 15

_CACHE_FILE_NAME = 'tvdb_cache.json'

# Franchise lists and series metadata change rarely, so cache for a week to
# keep repeat scans near-instant while still picking up new franchise entries.
_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
# Tokens are valid for ~1 month; refresh well before that. Re-login also
# happens automatically on any 401.
_TOKEN_TTL_SECONDS = 20 * 24 * 60 * 60


class TvdbService:
    """TheTVDB v4 wrapper for TV franchise gap-finding (issue #10).

    Works exactly like the movie collection logic: for each owned series we
    read its official franchise "lists" (TheTVDB returns these directly on the
    series extended record, the TV analogue of TMDB's belongs_to_collection),
    fetch each list's member series, and report the ones not in the library.
    All TheTVDB responses are cached so repeat scans are near-instant.
    """

    def __init__(self, base_url: str):
        self._base_url = base_url.rstrip('/')

        # Auth token cache (in-memory only — cheap to regenerate on restart).
        self._token: str | None = None
        self._token_at: float = 0.0
        self._auth_lock = threading.Lock()

        # Persistent caches (mirrors tmdb_service's two-map shape):
        #   _series_cache:  series_id -> {name, year, image, slug, lists:[list base dicts]}
        #   _list_cache:    list_id   -> {name, image, url, series:[member series ids]}
        self._cache_lock = threading.Lock()
        self._series_cache: dict[int, dict] = {}
        self._list_cache: dict[int, dict] = {}
        self._series_ts: dict[int, float] = {}
        self._list_ts: dict[int, float] = {}
        self._cache_file = os.path.join(config_store.data_dir(), _CACHE_FILE_NAME)
        self._load_cache()

        # Scan progress, mirroring TmdbService so the frontend polls it the
        # same way it polls the movie scan.
        self._scan_progress_lock = threading.Lock()
        self._scan_progress: dict = self._initial_scan_progress()
        # Monotonic scan token (guarded by _scan_progress_lock). Starting a new
        # scan or cancelling bumps it; the running worker stops the moment it
        # sees the token change. This avoids the stop-then-restart race where a
        # shared cancel flag could let the old scan keep running.
        self._scan_generation = 0

    # -- Config --

    def get_config(self) -> dict:
        saved = config_store.get(CONFIG_KEY, {}) or {}
        return {
            'enabled': bool(saved.get('api_key')),
            'api_key': saved.get('api_key', ''),
            'pin': saved.get('pin', ''),
            'language': saved.get('language', 'eng'),
        }

    def save_config(self, data: dict) -> dict:
        cleaned = {
            'api_key': (data.get('api_key') or '').strip(),
            'pin': (data.get('pin') or '').strip(),
            'language': (data.get('language') or 'eng').strip(),
        }
        config_store.put(CONFIG_KEY, cleaned)
        with self._auth_lock:
            self._token = None
            self._token_at = 0.0
        return self.get_config()

    def clear_config(self) -> None:
        config_store.remove(CONFIG_KEY)
        with self._auth_lock:
            self._token = None
            self._token_at = 0.0

    @property
    def is_configured(self) -> bool:
        cfg = config_store.get(CONFIG_KEY, {}) or {}
        return bool(cfg.get('api_key'))

    # -- Auth --

    def _login(self, api_key: str, pin: str | None) -> tuple[str | None, str | None]:
        """Exchange an API key (+ optional subscriber PIN) for a bearer token."""
        payload: dict = {'apikey': api_key}
        if pin:
            payload['pin'] = pin
        try:
            resp = requests.post(f'{self._base_url}/login', json=payload, timeout=DEFAULT_TIMEOUT)
        except requests.exceptions.RequestException as e:
            return None, f'Connection failed: {e}'

        if resp.status_code == 200:
            token = (resp.json().get('data') or {}).get('token')
            if token:
                return token, None
            return None, 'TheTVDB login returned no token'

        # Surface TheTVDB's own message (e.g. "pin required", "pin invalid") so
        # the user knows a subscriber PIN is needed for user-supported keys.
        api_message = ''
        try:
            api_message = (resp.json() or {}).get('message', '') or ''
        except ValueError:
            pass

        if 'pin' in api_message.lower():
            return None, (
                'This is a user-supported key, which requires your TheTVDB '
                'subscriber PIN (Dashboard → Account → Subscription).'
            )
        if resp.status_code == 401:
            return None, api_message or 'Invalid API key or PIN'
        return None, api_message or f'TheTVDB returned HTTP {resp.status_code}'

    def _get_token(self, force: bool = False) -> str | None:
        with self._auth_lock:
            if not force and self._token and (time.time() - self._token_at) < _TOKEN_TTL_SECONDS:
                return self._token
            cfg = config_store.get(CONFIG_KEY, {}) or {}
            api_key = cfg.get('api_key')
            if not api_key:
                return None
            token, error = self._login(api_key, cfg.get('pin'))
            if token:
                self._token = token
                self._token_at = time.time()
            else:
                logger.warning("TheTVDB login failed: %s", error)
                self._token = None
            return self._token

    def _request(self, path: str, params: dict | None = None) -> requests.Response | None:
        """Authenticated GET against the TVDB API with one auto re-auth on 401."""
        token = self._get_token()
        if not token:
            return None
        url = f'{self._base_url}{path}'
        for attempt in (1, 2):
            try:
                resp = requests.get(
                    url,
                    headers={'Authorization': f'Bearer {token}'},
                    params=params,
                    timeout=DEFAULT_TIMEOUT,
                )
            except requests.exceptions.RequestException as e:
                logger.warning("TheTVDB request to %s failed: %s", path, e)
                return None
            if resp.status_code == 401 and attempt == 1:
                token = self._get_token(force=True)
                if not token:
                    return resp
                continue
            return resp
        return None

    def test_connection(self, api_key: str, pin: str | None) -> tuple[bool, str]:
        if not api_key:
            return False, 'API key is required'
        token, error = self._login(api_key, pin)
        if token:
            return True, 'Connected to TheTVDB'
        return False, error or 'Connection failed'

    # -- Persistent cache --

    def clear_cache(self) -> None:
        with self._cache_lock:
            self._series_cache.clear()
            self._list_cache.clear()
            self._series_ts.clear()
            self._list_ts.clear()
        try:
            os.remove(self._cache_file)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("Failed to remove TVDB cache file: %s", e)

    def _load_cache(self) -> None:
        if not os.path.isfile(self._cache_file):
            return
        try:
            with open(self._cache_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Failed to load TVDB cache: %s", e)
            return
        if not isinstance(data, dict):
            return
        now = time.time()
        for src_key, dest, ts_dest in (
            ('series', self._series_cache, self._series_ts),
            ('lists', self._list_cache, self._list_ts),
        ):
            for raw_key, entry in (data.get(src_key) or {}).items():
                if not isinstance(entry, dict):
                    continue
                ts = entry.get('at')
                if not isinstance(ts, (int, float)) or now - ts > _CACHE_TTL_SECONDS:
                    continue
                value = entry.get('value')
                if not isinstance(value, dict):
                    continue
                try:
                    key = int(raw_key)
                except (TypeError, ValueError):
                    continue
                dest[key] = value
                ts_dest[key] = ts
        if self._series_cache or self._list_cache:
            logger.info(
                "Loaded TVDB cache: %d series, %d franchise lists",
                len(self._series_cache), len(self._list_cache),
            )

    def _save_cache(self) -> None:
        now = time.time()
        with self._cache_lock:
            for key in self._series_cache:
                self._series_ts.setdefault(key, now)
            for key in self._list_cache:
                self._list_ts.setdefault(key, now)
            payload = {
                'version': 1,
                'series': {
                    str(k): {'value': v, 'at': self._series_ts.get(k, now)}
                    for k, v in self._series_cache.items()
                },
                'lists': {
                    str(k): {'value': v, 'at': self._list_ts.get(k, now)}
                    for k, v in self._list_cache.items()
                },
            }
        try:
            tmp = self._cache_file + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(payload, f)
            os.replace(tmp, self._cache_file)
        except OSError as e:
            logger.warning("Failed to persist TVDB cache: %s", e)

    # -- TheTVDB lookups (cached) --

    def _get_series_extended(self, series_id: int) -> dict | None:
        """Fetch a series' extended record (metadata + franchise lists), cached.

        Returns {name, year, image, slug, lists:[list base dicts]}.
        """
        with self._cache_lock:
            cached = self._series_cache.get(series_id)
            # Re-fetch entries cached before 'firstAired' was tracked (migration).
            if cached is not None and 'firstAired' in cached:
                return cached

        resp = self._request(f'/series/{series_id}/extended', params={'short': 'true'})
        if resp is None or resp.status_code != 200:
            return None
        data = (resp.json() or {}).get('data') or {}
        first_aired = data.get('firstAired') or ''
        meta = {
            'name': data.get('name', 'Unknown'),
            'year': data.get('year') or (first_aired[:4] if first_aired else None),
            'firstAired': first_aired,
            'image': data.get('image'),
            'slug': data.get('slug'),
            'overview': data.get('overview', ''),
            'lists': [
                {
                    'id': lst.get('id'),
                    'name': lst.get('name', 'Unknown franchise'),
                    'image': lst.get('image'),
                    'url': lst.get('url'),
                    'isOfficial': bool(lst.get('isOfficial')),
                }
                for lst in (data.get('lists') or [])
                if lst.get('id') is not None
            ],
        }
        with self._cache_lock:
            self._series_cache[series_id] = meta
        return meta

    def _get_list_members(self, list_id: int) -> dict | None:
        """Fetch a franchise list's member series IDs (+ list metadata), cached."""
        with self._cache_lock:
            if list_id in self._list_cache:
                return self._list_cache[list_id]

        resp = self._request(f'/lists/{list_id}/extended')
        if resp is None or resp.status_code != 200:
            return None
        data = (resp.json() or {}).get('data') or {}
        series_ids = []
        for ent in (data.get('entities') or []):
            sid = ent.get('seriesId')
            if isinstance(sid, int) and sid > 0:
                series_ids.append(sid)
        info = {
            'name': data.get('name', 'Unknown franchise'),
            'image': data.get('image'),
            'url': data.get('url'),
            'series': series_ids,
        }
        with self._cache_lock:
            self._list_cache[list_id] = info
        return info

    # -- Gap-finding --

    def find_franchise_gaps(
        self,
        owned_shows: list[dict],
        owned_series_ids: set[int],
        show_existing: bool = False,
        generation: int | None = None,
    ) -> list[dict]:
        """For each owned series, find official franchise members not in the library.

        TheTVDB lookups are issued concurrently so a large library scans in
        seconds rather than minutes. Progress spans three phases (owned-show
        lookups, franchise-member lists, member metadata) so the bar keeps
        moving instead of stalling at 100% during the back half.
        """
        def superseded() -> bool:
            return generation is not None and self._scan_generation != generation

        series_ids = [s['tvdbId'] for s in owned_shows if isinstance(s.get('tvdbId'), int)]
        id_to_name = {s['tvdbId']: s.get('name', '') for s in owned_shows
                      if isinstance(s.get('tvdbId'), int)}
        seen_lists: set[int] = set()
        relevant_lists: list[dict] = []  # list-base dicts, deduped

        def set_phase(phase: str, total: int) -> None:
            with self._scan_progress_lock:
                self._scan_progress['phase'] = phase
                self._scan_progress['total'] = total
                self._scan_progress['processed'] = 0

        # Phase 1: fetch each owned show's extended record (which carries its
        # franchise lists) in parallel. Each phase has its own count, so the
        # denominator stays meaningful instead of growing as work is discovered.
        set_phase('shows', len(series_ids))
        processed = 0
        with ThreadPoolExecutor(max_workers=_SCAN_WORKERS) as ex:
            futures = {ex.submit(self._get_series_extended, sid): sid for sid in series_ids}
            for fut in as_completed(futures):
                if superseded():
                    return []
                processed += 1
                meta = fut.result()
                with self._scan_progress_lock:
                    self._scan_progress['processed'] = processed
                    self._scan_progress['current_show'] = id_to_name.get(futures[fut], '')
                if not meta:
                    continue
                for lst in meta.get('lists', []):
                    if not lst.get('isOfficial'):
                        continue
                    list_id = lst.get('id')
                    if list_id in seen_lists:
                        continue
                    seen_lists.add(list_id)
                    relevant_lists.append(lst)
                with self._scan_progress_lock:
                    self._scan_progress['franchises_found'] = len(relevant_lists)

        if superseded():
            return []

        # Phase 2: fetch each relevant franchise's member list in parallel.
        set_phase('franchises', len(relevant_lists))
        processed = 0
        members_by_list: list[tuple[dict, dict]] = []
        with ThreadPoolExecutor(max_workers=_SCAN_WORKERS) as ex:
            futures = {ex.submit(self._get_list_members, lst['id']): lst for lst in relevant_lists}
            for fut in as_completed(futures):
                if superseded():
                    return []
                processed += 1
                members = fut.result()
                with self._scan_progress_lock:
                    self._scan_progress['processed'] = processed
                if members and len(members.get('series', [])) >= 2:
                    members_by_list.append((futures[fut], members))

        # Determine which member series still need metadata (cached ones are free).
        needed: set[int] = set()
        for _lst, members in members_by_list:
            for sid in members.get('series', []):
                if sid in owned_series_ids and not show_existing:
                    continue
                needed.add(sid)

        # Phase 3: prefetch member metadata in parallel.
        set_phase('titles', len(needed))
        processed = 0
        with ThreadPoolExecutor(max_workers=_SCAN_WORKERS) as ex:
            futures = {ex.submit(self._get_series_extended, sid): sid for sid in needed}
            for fut in as_completed(futures):
                if superseded():
                    return []
                processed += 1
                fut.result()
                with self._scan_progress_lock:
                    self._scan_progress['processed'] = processed

        # Build gaps from the now-warm cache (no further network calls).
        gaps: list[dict] = []
        for lst, _members in members_by_list:
            gaps.extend(self._collect_list_gaps(lst, owned_series_ids, show_existing))

        self._save_cache()
        gaps.sort(key=lambda g: (g['franchiseName'], str(g['year'])))
        return gaps

    def _collect_list_gaps(
        self,
        lst: dict,
        owned_series_ids: set[int],
        show_existing: bool,
    ) -> list[dict]:
        """Build gap entries for a single franchise list's members."""
        members = self._get_list_members(lst['id'])
        if not members:
            return []
        member_ids = members.get('series', [])
        if len(member_ids) < 2:
            return []  # nothing can be "missing" from a single-entry list
        franchise_name = members.get('name') or lst.get('name', 'Unknown franchise')
        out = []
        for sid in member_ids:
            is_owned = sid in owned_series_ids
            if is_owned and not show_existing:
                continue
            meta = self._get_series_extended(sid)
            if not meta:
                continue
            out.append({
                'tvdbId': sid,
                'name': meta.get('name', 'Unknown'),
                'year': meta.get('year') or 'N/A',
                'releaseDate': meta.get('firstAired') or '',
                'posterUrl': meta.get('image'),
                'overview': meta.get('overview', ''),
                'slug': meta.get('slug'),
                'franchiseName': franchise_name,
                'owned': is_owned,
            })
        return out

    def find_gaps_for_show(
        self,
        series_id: int,
        owned_series_ids: set[int],
        show_existing: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """Find franchise gaps for a single owned series (click-through lookup)."""
        meta = self._get_series_extended(series_id)
        if not meta:
            return None, 'Could not load this show from TheTVDB'

        gaps: list[dict] = []
        seen_lists: set[int] = set()
        for lst in meta.get('lists', []):
            if not lst.get('isOfficial'):
                continue
            list_id = lst.get('id')
            if list_id in seen_lists:
                continue
            seen_lists.add(list_id)
            gaps.extend(self._collect_list_gaps(lst, owned_series_ids, show_existing))

        self._save_cache()
        gaps.sort(key=lambda g: (g['franchiseName'], str(g['year'])))
        return gaps, None

    # -- Scan orchestration --

    @staticmethod
    def _initial_scan_progress() -> dict:
        progress = {
            'status': 'idle',    # idle | scanning | done | error
            'phase': 'shows',    # shows | franchises | titles
            'processed': 0,
            'total': 0,
            'current_show': '',
            'franchises_found': 0,
            'gaps': [],
            'total_owned': 0,
            'libraries': [],
            'completed_at': None,
            'error': None,
        }
        last = config_store.get('last_tv_scan')
        if last:
            progress['status'] = 'done'
            progress['gaps'] = last.get('gaps', [])
            progress['total_owned'] = last.get('total_owned', 0)
            progress['libraries'] = last.get('libraries', [])
            progress['completed_at'] = last.get('completed_at')
        return progress

    @property
    def scan_progress(self) -> dict:
        with self._scan_progress_lock:
            return dict(self._scan_progress)

    def start_scan(
        self,
        owned_shows: list[dict],
        owned_series_ids: set[int],
        show_existing: bool = False,
        library_names: list[str] | None = None,
    ) -> None:
        libraries = list(library_names or [])
        with self._scan_progress_lock:
            # Bump the token first so any still-winding-down previous scan stops
            # and its results are ignored; this scan owns the new token.
            self._scan_generation += 1
            generation = self._scan_generation
            self._scan_progress = {
                'status': 'scanning',
                'phase': 'shows',
                'processed': 0,
                'total': len(owned_shows),
                'current_show': '',
                'franchises_found': 0,
                'gaps': [],
                'total_owned': len(owned_series_ids),
                'libraries': libraries,
                'completed_at': None,
                'error': None,
            }

        thread = threading.Thread(
            target=self._run_scan,
            args=(list(owned_shows), set(owned_series_ids), show_existing, libraries, generation),
            daemon=True,
        )
        thread.start()

    def cancel_scan(self) -> bool:
        """Stop the running scan. Returns True if a scan was running."""
        with self._scan_progress_lock:
            if self._scan_progress['status'] != 'scanning':
                return False
            # Bumping the token makes the worker stop and discard its results.
            self._scan_generation += 1
            self._scan_progress = {
                'status': 'cancelled',
                'processed': 0,
                'total': 0,
                'current_show': '',
                'franchises_found': 0,
                'gaps': [],
                'total_owned': 0,
                'libraries': [],
                'completed_at': None,
                'error': None,
            }
        return True

    def _run_scan(
        self,
        owned_shows: list[dict],
        owned_series_ids: set[int],
        show_existing: bool,
        libraries: list[str],
        generation: int,
    ) -> None:
        try:
            gaps = self.find_franchise_gaps(owned_shows, owned_series_ids, show_existing, generation)
            completed_at = datetime.now(timezone.utc).isoformat()
            with self._scan_progress_lock:
                # A newer scan or a cancel superseded us — leave their state alone.
                if self._scan_generation != generation:
                    return
                self._scan_progress['gaps'] = gaps
                self._scan_progress['completed_at'] = completed_at
                self._scan_progress['status'] = 'done'
            try:
                config_store.put('last_tv_scan', {
                    'gaps': gaps,
                    'total_owned': len(owned_series_ids),
                    'libraries': libraries,
                    'completed_at': completed_at,
                })
            except OSError as e:
                logger.warning("Failed to persist last_tv_scan: %s", e)
            missing_gaps = [g for g in gaps if not g.get('owned')]
            scan_history.record(
                media_type='tv',
                libraries=libraries,
                total_owned=len(owned_series_ids),
                missing=len(missing_gaps),
                status='success',
                trigger='manual',
                completed_at=completed_at,
                gaps=missing_gaps,
            )
        except Exception as e:
            logger.exception("TVDB scan failed")
            with self._scan_progress_lock:
                if self._scan_generation == generation:
                    self._scan_progress['error'] = str(e)
                    self._scan_progress['status'] = 'error'
            scan_history.record(
                media_type='tv',
                libraries=libraries,
                total_owned=len(owned_series_ids),
                missing=0,
                status='error',
                trigger='manual',
                message=str(e),
            )
