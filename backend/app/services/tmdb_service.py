import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
import requests
from app.services import config_store

logger = logging.getLogger(__name__)

_CACHE_FILE_NAME = 'tmdb_cache.json'
# Collection memberships rarely change but new movies can be added to existing
# collections (sequels, reissues), so re-fetch weekly to balance freshness vs.
# TMDB rate limits.
_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
        self._api_key: str | None = config_store.get('tmdb_api_key')
        self._language: str = config_store.get('preferences', {}).get('language', 'en')

        # In-memory caches to avoid redundant TMDB API calls
        self._id_cache: dict[str, int | None] = {}
        self._movie_collection_cache: dict[int, int | None] = {}
        self._collection_cache: dict[int, dict] = {}

        # Persistent cache for the collection lookups (the expensive ones).
        # _id_cache is intentionally not persisted — its search-key entries are
        # cheap to regenerate and least stable. Per-entry timestamps live in
        # parallel dicts so the in-memory cache shape stays unchanged.
        self._mc_cache_ts: dict[int, float] = {}
        self._coll_cache_ts: dict[int, float] = {}
        self._cache_file = os.path.join(config_store.data_dir(), _CACHE_FILE_NAME)
        # _cache_lock protects in-memory dict reads/writes (held briefly).
        # _cache_save_lock protects the file I/O on persist (held while writing
        # the temp file). Separate so HTTP-driven dict updates don't block on
        # the multi-MB JSON write to disk.
        self._cache_lock = threading.Lock()
        self._cache_save_lock = threading.Lock()
        self._load_persistent_cache()

        # Scan progress tracking (shared between request thread and scan thread).
        # Seeded from the last persisted scan so the "Last Scan" card and gaps
        # list survive a backend restart.
        self._scan_progress_lock = threading.Lock()
        self._scan_progress: dict = self._initial_scan_progress()

    @staticmethod
    def _initial_scan_progress() -> dict:
        progress = {
            'status': 'idle',    # idle | scanning | done | error
            'processed': 0,
            'total': 0,
            'current_movie': '',
            'collections_found': 0,
            'gaps': [],
            'total_owned': 0,
            'completed_at': None,
            'error': None,
        }
        last = config_store.get('last_scan')
        if last:
            progress['status'] = 'done'
            progress['gaps'] = last.get('gaps', [])
            progress['total_owned'] = last.get('total_owned', 0)
            progress['completed_at'] = last.get('completed_at')
        return progress

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def reload_preferences(self) -> None:
        """Reload language preference from config store."""
        self._language = config_store.get('preferences', {}).get('language', 'en')

    def clear_cache(self) -> None:
        """Clear all TMDB response caches for a fresh scan."""
        with self._cache_lock:
            self._id_cache.clear()
            self._movie_collection_cache.clear()
            self._collection_cache.clear()
            self._mc_cache_ts.clear()
            self._coll_cache_ts.clear()
        try:
            os.remove(self._cache_file)
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("Failed to remove TMDB cache file: %s", e)

    def _load_persistent_cache(self) -> None:
        """Populate in-memory caches from disk, dropping entries older than the TTL."""
        if not os.path.isfile(self._cache_file):
            return
        try:
            with open(self._cache_file, 'r') as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Failed to load TMDB cache from %s: %s", self._cache_file, e)
            return
        if not isinstance(data, dict):
            return

        now = time.time()
        for raw_key, entry in (data.get('movie_collection') or {}).items():
            if not isinstance(entry, dict):
                continue
            ts = entry.get('at')
            if not isinstance(ts, (int, float)) or now - ts > _CACHE_TTL_SECONDS:
                continue
            try:
                key = int(raw_key)
            except (TypeError, ValueError):
                continue
            value = entry.get('value')
            if value is not None and not isinstance(value, int):
                continue
            self._movie_collection_cache[key] = value
            self._mc_cache_ts[key] = ts

        for raw_key, entry in (data.get('collections') or {}).items():
            if not isinstance(entry, dict):
                continue
            ts = entry.get('at')
            if not isinstance(ts, (int, float)) or now - ts > _CACHE_TTL_SECONDS:
                continue
            try:
                key = int(raw_key)
            except (TypeError, ValueError):
                continue
            value = entry.get('value')
            if not isinstance(value, dict):
                continue
            self._collection_cache[key] = value
            self._coll_cache_ts[key] = ts

        if self._movie_collection_cache or self._collection_cache:
            logger.info(
                "Loaded TMDB cache: %d collection memberships, %d collections",
                len(self._movie_collection_cache),
                len(self._collection_cache),
            )

    def _save_persistent_cache(self) -> None:
        """Write the persistent caches to disk via atomic rename."""
        now = time.time()
        # Snapshot under the cache lock so concurrent inserts can't corrupt
        # the iteration. JSON serialization and file I/O happen outside the
        # lock to keep contention with the HTTP-driven cache mutations short.
        with self._cache_lock:
            for key in self._movie_collection_cache:
                self._mc_cache_ts.setdefault(key, now)
            for key in self._collection_cache:
                self._coll_cache_ts.setdefault(key, now)
            mc_snapshot = list(self._movie_collection_cache.items())
            coll_snapshot = list(self._collection_cache.items())
            mc_ts = dict(self._mc_cache_ts)
            coll_ts = dict(self._coll_cache_ts)

        payload: dict = {
            'version': 1,
            'movie_collection': {
                str(key): {'value': value, 'at': mc_ts.get(key, now)}
                for key, value in mc_snapshot
            },
            'collections': {
                str(key): {'value': value, 'at': coll_ts.get(key, now)}
                for key, value in coll_snapshot
            },
        }

        with self._cache_save_lock:
            try:
                tmp = self._cache_file + '.tmp'
                with open(tmp, 'w') as f:
                    json.dump(payload, f)
                os.replace(tmp, self._cache_file)
            except OSError as e:
                logger.warning("Failed to persist TMDB cache: %s", e)

    def test_api_key(self, api_key: str) -> tuple[bool, int]:
        url = f"{self._base_url}/configuration?api_key={api_key}"
        response = requests.get(url, timeout=10)
        return response.status_code == 200, response.status_code

    def save_api_key(self, api_key: str) -> tuple[bool, int]:
        valid, status_code = self.test_api_key(api_key)
        if valid:
            self._api_key = api_key
            config_store.put('tmdb_api_key', api_key)
        return valid, status_code

    def resolve_tmdb_id(
        self,
        api_key: str,
        tmdb_id: int | None,
        imdb_id: str | None,
        title: str | None,
        year: int | None,
    ) -> int | None:
        """Resolve a TMDB ID using fallback chain: TMDB ID -> IMDB /find -> title+year search."""
        # 1. Already have a TMDB ID
        if tmdb_id:
            return tmdb_id

        # 2. Try IMDB ID via /find endpoint (cached)
        if imdb_id:
            cache_key = f"imdb:{imdb_id}"
            with self._cache_lock:
                if cache_key in self._id_cache:
                    return self._id_cache[cache_key]
            resolved: int | None = None
            try:
                resp = requests.get(
                    f"{self._base_url}/find/{imdb_id}",
                    params={"api_key": api_key, "external_source": "imdb_id"},
                    timeout=10,
                )
                if resp.status_code == 200:
                    results = resp.json().get("movie_results", [])
                    if results:
                        resolved = results[0]["id"]
            except Exception as e:
                logger.warning("TMDB /find lookup failed for IMDB ID %s: %s", imdb_id, e)
            with self._cache_lock:
                self._id_cache[cache_key] = resolved
            if resolved is not None:
                return resolved

        # 3. Try title + year search (cached)
        if title:
            cache_key = f"search:{title.lower()}|{year}"
            with self._cache_lock:
                if cache_key in self._id_cache:
                    return self._id_cache[cache_key]
            resolved = None
            try:
                params = {"api_key": api_key, "query": title, "language": self._language}
                if year:
                    params["year"] = year
                resp = requests.get(
                    f"{self._base_url}/search/movie",
                    params=params,
                    timeout=10,
                )
                if resp.status_code == 200:
                    results = resp.json().get("results", [])
                    if results:
                        # Prefer exact title + year match
                        resolved = results[0]["id"]
                        for r in results:
                            r_year = r.get("release_date", "")[:4]
                            if r.get("title", "").lower() == title.lower() and r_year == str(year):
                                resolved = r["id"]
                                break
            except Exception as e:
                logger.warning("TMDB search failed for '%s' (%s): %s", title, year, e)
            with self._cache_lock:
                self._id_cache[cache_key] = resolved
            if resolved is not None:
                return resolved

        return None

    def _get_collection_id(self, api_key: str, tmdb_id: int) -> int | None:
        """Get the collection ID for a movie, using cache."""
        with self._cache_lock:
            if tmdb_id in self._movie_collection_cache:
                return self._movie_collection_cache[tmdb_id]

        coll_id: int | None = None
        try:
            resp = requests.get(
                f"{self._base_url}/movie/{tmdb_id}",
                params={"api_key": api_key, "language": self._language},
                timeout=10,
            )
            if resp.status_code == 200:
                collection = resp.json().get("belongs_to_collection")
                coll_id = collection["id"] if collection else None
        except Exception as e:
            logger.warning("Failed to get collection ID for TMDB %s: %s", tmdb_id, e)

        with self._cache_lock:
            self._movie_collection_cache[tmdb_id] = coll_id
        return coll_id

    def _get_collection(self, api_key: str, collection_id: int) -> dict | None:
        """Fetch full collection data, using cache."""
        with self._cache_lock:
            if collection_id in self._collection_cache:
                return self._collection_cache[collection_id]

        try:
            resp = requests.get(
                f"{self._base_url}/collection/{collection_id}",
                params={"api_key": api_key, "language": self._language},
                timeout=10,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
        except Exception as e:
            logger.warning("Failed to fetch collection %s: %s", collection_id, e)
            return None

        with self._cache_lock:
            self._collection_cache[collection_id] = data
        return data

    def _build_gap_entries(
        self,
        coll_data: dict,
        owned_tmdb_ids: set[int],
        show_existing: bool,
    ) -> list[dict]:
        """Build gap entry dicts from collection data."""
        collection_name = coll_data.get("name", "Unknown Collection")
        entries = []
        for part in coll_data.get("parts", []):
            part_id = part["id"]
            is_owned = part_id in owned_tmdb_ids
            if not show_existing and is_owned:
                continue
            poster = part.get("poster_path")
            release_date = part.get("release_date") or ""
            entries.append({
                "tmdbId": part_id,
                "name": part.get("title", "Unknown"),
                "year": release_date[:4] if release_date else "N/A",
                "releaseDate": release_date,
                "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                "overview": part.get("overview", ""),
                "collectionName": collection_name,
                "owned": is_owned,
            })
        return entries

    @property
    def scan_progress(self) -> dict:
        with self._scan_progress_lock:
            return dict(self._scan_progress)

    def start_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
    ) -> None:
        """Start a library scan in a background thread."""
        with self._scan_progress_lock:
            if self._scan_progress['status'] == 'scanning':
                return  # Already running
            self._scan_progress = {
                'status': 'scanning',
                'processed': 0,
                'total': len(owned_movies),
                'current_movie': '',
                'collections_found': 0,
                'gaps': [],
                'total_owned': len(owned_tmdb_ids),
                'completed_at': None,
                'error': None,
            }

        thread = threading.Thread(
            target=self._run_scan,
            args=(api_key, owned_movies, owned_tmdb_ids, show_existing),
            daemon=True,
        )
        thread.start()

    def _run_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool,
    ) -> None:
        """Background scan worker."""
        try:
            gaps, _ = self.find_collection_gaps(api_key, owned_movies, owned_tmdb_ids, show_existing)
            completed_at = datetime.now(timezone.utc).isoformat()
            final_gaps = gaps or []
            with self._scan_progress_lock:
                self._scan_progress['gaps'] = final_gaps
                self._scan_progress['total_owned'] = len(owned_tmdb_ids)
                self._scan_progress['completed_at'] = completed_at
                self._scan_progress['status'] = 'done'
            try:
                config_store.put('last_scan', {
                    'gaps': final_gaps,
                    'total_owned': len(owned_tmdb_ids),
                    'completed_at': completed_at,
                })
            except OSError as e:
                logger.warning("Failed to persist last_scan: %s", e)
        except Exception as e:
            with self._scan_progress_lock:
                self._scan_progress['error'] = str(e)
                self._scan_progress['status'] = 'error'

    def find_collection_gaps(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """
        For each owned movie, check if it belongs to a TMDB collection.
        Then fetch the full collection and find movies not in the library.

        All TMDB responses are cached so repeat scans are near-instant.
        """
        seen_collections: set[int] = set()
        gaps = []
        total = len(owned_movies)

        for i, movie in enumerate(owned_movies):
            # Update progress
            with self._scan_progress_lock:
                self._scan_progress['processed'] = i + 1
                self._scan_progress['current_movie'] = movie.get('name', '')

            tmdb_id = self.resolve_tmdb_id(
                api_key,
                movie.get('tmdbId'),
                movie.get('imdbId'),
                movie.get('name'),
                movie.get('year'),
            )
            if not tmdb_id:
                continue

            owned_tmdb_ids.add(tmdb_id)

            collection_id = self._get_collection_id(api_key, tmdb_id)
            if not collection_id or collection_id in seen_collections:
                continue
            seen_collections.add(collection_id)
            with self._scan_progress_lock:
                self._scan_progress['collections_found'] = len(seen_collections)

            coll_data = self._get_collection(api_key, collection_id)
            if not coll_data:
                continue

            gaps.extend(self._build_gap_entries(coll_data, owned_tmdb_ids, show_existing))

        gaps.sort(key=lambda g: (g["collectionName"], g["year"]))
        self._save_persistent_cache()
        return gaps, None

    def find_gaps_for_movie(
        self,
        api_key: str,
        tmdb_id: int | None,
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
        imdb_id: str | None = None,
        title: str | None = None,
        year: int | None = None,
    ) -> tuple[list[dict] | None, str | None]:
        """Find collection gaps for a single movie. Uses cached data when available."""
        tmdb_id = self.resolve_tmdb_id(api_key, tmdb_id, imdb_id, title, year)
        if not tmdb_id:
            return None, "Could not resolve movie to a TMDB ID"

        collection_id = self._get_collection_id(api_key, tmdb_id)
        if not collection_id:
            return [], None

        coll_data = self._get_collection(api_key, collection_id)
        if not coll_data:
            return None, "Failed to fetch collection details"

        results = self._build_gap_entries(coll_data, owned_tmdb_ids, show_existing)
        results.sort(key=lambda r: r["year"])
        return results, None
