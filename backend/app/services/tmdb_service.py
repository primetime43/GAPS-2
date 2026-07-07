import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import requests
from app.services import config_store, scan_history
from app.services.scan_progress import ScanProgressTracker

logger = logging.getLogger(__name__)

_CACHE_FILE_NAME = 'tmdb_cache.json'
# External-id maps live in their own file so an actor lookup (which resolves a few
# new ids) doesn't rewrite the much larger collection cache every time.
_ID_CACHE_FILE_NAME = 'tmdb_external_ids.json'

# Heuristics for decluttering an actor's filmography (issue #49): TMDB's
# movie_credits cast list mixes real acting roles with DVD extras, featurettes,
# "making-of" docs, and "as themselves" tribute/talk-show appearances. These
# signals flag the latter so they're hidden by default (revealable via a toggle).
_DOCUMENTARY_GENRE_ID = 99
# Genres that signal non-acting filler in a filmography: documentary (99) plus
# the TV-only talk (10767), news (10763), and reality (10764) genres, which are
# almost always "as themselves" appearances rather than roles.
_MINOR_GENRE_IDS = {99, 10767, 10763, 10764}
_MINOR_VOTE_THRESHOLD = 10
# Word-boundary match so "Self/Himself/Herself" credits are caught without
# nuking real characters that merely contain the letters (e.g. "Selfridge").
_SELF_APPEARANCE_RE = re.compile(r"\b(self|himself|herself|themselves)\b", re.IGNORECASE)
# Collection memberships rarely change but new movies can be added to existing
# collections (sequels, reissues), so re-fetch weekly to balance freshness vs.
# TMDB rate limits.
_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
# External-id maps (TMDB->IMDb, TMDB->TheTVDB) are effectively immutable, so they
# get a much longer TTL — the whole point is to resolve each title from TMDB once
# and never pay that per-movie /external_ids call again. The long expiry is just a
# self-heal backstop for the rare bad entry.
_ID_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60
# Concurrency for batch /external_ids resolution. TMDB tolerates ~50 req/s, so
# this stays well under the limit while cutting wall-clock on a cold (uncached)
# filmography. Single source of truth — callers use the batch helpers below.
_EXTERNAL_ID_WORKERS = 16
# Popular titles (and their lead casts) only shift over days as new releases
# trend, so cache the derived suggestions for a day. In-memory only, so a restart
# refetches regardless.
_POPULAR_CACHE_TTL_SECONDS = 24 * 60 * 60


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
        # Shared HTTP session: connection pooling + keep-alive so the hundreds of
        # TMDB calls during a scan reuse connections instead of paying a fresh
        # TLS handshake each time. pool_maxsize matches the worker count so
        # concurrent workers don't exhaust the pool (which would churn connections).
        self._session = requests.Session()
        _adapter = requests.adapters.HTTPAdapter(pool_connections=10, pool_maxsize=_EXTERNAL_ID_WORKERS)
        self._session.mount('https://', _adapter)  # TMDB is HTTPS-only
        self._api_key: str | None = config_store.get('tmdb_api_key')
        # Preference-derived scan settings (language + quality filter). Loaded
        # here and refreshed via reload_preferences() when the user saves.
        self._language: str = 'en'
        self._quality_filter_enabled: bool = False
        self._min_rating: float = 0.0
        self._min_vote_count: int = 0
        self._apply_preferences()

        # In-memory caches to avoid redundant TMDB API calls
        self._id_cache: dict[str, int | None] = {}
        self._movie_collection_cache: dict[int, int | None] = {}
        self._collection_cache: dict[int, dict] = {}
        # Actor filmography lookups (issue #49). Not persisted — credits change as
        # actors make new films, and these are cheap single calls to regenerate.
        self._person_credits_cache: dict[int, dict] = {}
        # Movie -> IMDb ID lookups for external links / IMDb ratings. Persisted
        # (see _save_id_cache): IMDb IDs are stable, and resolving them is one TMDB
        # /external_ids call *per movie*, so the Actors filmography view would
        # otherwise re-pay dozens of calls every session. Cache once, keep. A
        # cached None (TMDB has no IMDb id) is kept in memory but NOT persisted, so
        # a title that gains an id later is re-checked after a restart.
        self._imdb_id_cache: dict[int, str | None] = {}
        # TMDB TV id -> {tvdbId, imdbId}, for actor TV gaps (Sonarr / ignore /
        # IMDb ratings). Persisted like _imdb_id_cache; a fully-empty result
        # ({tvdbId: None, imdbId: None}) is a negative and not persisted.
        self._tv_external_cache: dict[int, dict] = {}
        # TMDB movie genre id→name list (small, static); fetched once on demand.
        self._genre_cache: list[dict] | None = None
        # Suggested actors for the empty-search grid, keyed by media type
        # ('movie'/'tv') -> {'people': [...], 'at': float}. Cached briefly
        # (see _POPULAR_CACHE_TTL_SECONDS). In-memory only.
        self._popular_people_cache: dict[str, dict] = {}

        # Persistent cache for the collection lookups (the expensive ones).
        # _id_cache is intentionally not persisted — its search-key entries are
        # cheap to regenerate and least stable. Per-entry timestamps live in
        # parallel dicts so the in-memory cache shape stays unchanged.
        self._mc_cache_ts: dict[int, float] = {}
        self._coll_cache_ts: dict[int, float] = {}
        self._imdb_id_cache_ts: dict[int, float] = {}
        self._tv_external_cache_ts: dict[int, float] = {}
        # Set when an id map gains a new entry; persist_caches() skips the disk
        # write entirely when nothing changed (e.g. an all-cache-hit lookup).
        self._id_cache_dirty = False
        self._cache_file = os.path.join(config_store.data_dir(), _CACHE_FILE_NAME)
        self._id_cache_file = os.path.join(config_store.data_dir(), _ID_CACHE_FILE_NAME)
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
        self._scan = ScanProgressTracker(
            extra_fields={'current_movie': '', 'collections_found': 0},
            seed_key='last_scan',
        )

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def reload_preferences(self) -> None:
        """Reload preference-derived scan settings from the config store."""
        self._apply_preferences()

    def _apply_preferences(self) -> None:
        prefs = config_store.get('preferences', {})
        self._language = prefs.get('language', 'en')
        self._quality_filter_enabled = bool(prefs.get('qualityFilterEnabled', False))
        try:
            self._min_rating = float(prefs.get('minRating', 0) or 0)
        except (TypeError, ValueError):
            self._min_rating = 0.0
        try:
            self._min_vote_count = int(prefs.get('minVoteCount', 0) or 0)
        except (TypeError, ValueError):
            self._min_vote_count = 0

    @staticmethod
    def _is_released(release_date: str) -> bool:
        """True if the movie has a release date on or before today.

        The quality filter only applies to released titles — unreleased
        movies have no meaningful vote_average/vote_count yet, and filtering
        them here would duplicate (and fight with) the future-release toggle.
        """
        if not release_date or len(release_date) < 10:
            return False
        today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        return release_date[:10] <= today

    def _passes_quality_filter(self, part: dict) -> bool:
        """Whether a missing movie clears the configured rating/vote thresholds."""
        if not self._quality_filter_enabled:
            return True
        if not self._is_released(part.get("release_date") or ""):
            return True
        vote_average = part.get("vote_average") or 0
        vote_count = part.get("vote_count") or 0
        if self._min_rating and vote_average < self._min_rating:
            return False
        if self._min_vote_count and vote_count < self._min_vote_count:
            return False
        return True

    def clear_cache(self) -> None:
        """Clear all TMDB response caches for a fresh scan."""
        with self._cache_lock:
            self._id_cache.clear()
            self._movie_collection_cache.clear()
            self._collection_cache.clear()
            self._imdb_id_cache.clear()
            self._tv_external_cache.clear()
            self._mc_cache_ts.clear()
            self._coll_cache_ts.clear()
            self._imdb_id_cache_ts.clear()
            self._tv_external_cache_ts.clear()
            self._id_cache_dirty = False
        for path in (self._cache_file, self._id_cache_file):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError as e:
                logger.warning("Failed to remove TMDB cache file %s: %s", path, e)

    @staticmethod
    def _read_cache_json(path: str) -> dict | None:
        """Read a JSON cache file, returning the dict or None on absence/error."""
        if not os.path.isfile(path):
            return None
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Failed to load cache from %s: %s", path, e)
            return None
        return data if isinstance(data, dict) else None

    def _atomic_write_json(self, path: str, payload: dict) -> None:
        """Write payload to path via temp-file + atomic rename (UTF-8)."""
        with self._cache_save_lock:
            try:
                tmp = path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(payload, f)
                os.replace(tmp, path)
            except OSError as e:
                logger.warning("Failed to persist cache %s: %s", path, e)

    def _load_persistent_cache(self) -> None:
        """Populate in-memory caches from disk, dropping entries older than the TTL.

        Collections live in `_cache_file`; the external-id maps live in their own
        `_id_cache_file`. For installs that predate the split, the id maps may
        still be embedded in the collection file — read them from there as a
        one-time migration when the dedicated file isn't present yet.
        """
        collection_data = self._read_cache_json(self._cache_file)
        if collection_data:
            self._load_collection_sections(collection_data)

        id_data = self._read_cache_json(self._id_cache_file)
        if id_data is None:
            id_data = collection_data  # migrate from the legacy combined file
        if id_data:
            self._load_id_sections(id_data)

        if self._movie_collection_cache or self._collection_cache:
            logger.info(
                "Loaded TMDB cache: %d collection memberships, %d collections, "
                "%d imdb ids, %d tv external ids",
                len(self._movie_collection_cache),
                len(self._collection_cache),
                len(self._imdb_id_cache),
                len(self._tv_external_cache),
            )

    def _load_collection_sections(self, data: dict) -> None:
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

    def _load_id_sections(self, data: dict) -> None:
        now = time.time()
        for raw_key, entry in (data.get('imdb_ids') or {}).items():
            if not isinstance(entry, dict):
                continue
            ts = entry.get('at')
            if not isinstance(ts, (int, float)) or now - ts > _ID_CACHE_TTL_SECONDS:
                continue
            try:
                key = int(raw_key)
            except (TypeError, ValueError):
                continue
            value = entry.get('value')
            if value is not None and not isinstance(value, str):
                continue
            self._imdb_id_cache[key] = value
            self._imdb_id_cache_ts[key] = ts

        for raw_key, entry in (data.get('tv_external') or {}).items():
            if not isinstance(entry, dict):
                continue
            ts = entry.get('at')
            if not isinstance(ts, (int, float)) or now - ts > _ID_CACHE_TTL_SECONDS:
                continue
            try:
                key = int(raw_key)
            except (TypeError, ValueError):
                continue
            value = entry.get('value')
            if not isinstance(value, dict):
                continue
            self._tv_external_cache[key] = {
                'tvdbId': value.get('tvdbId'),
                'imdbId': value.get('imdbId'),
            }
            self._tv_external_cache_ts[key] = ts

    def _save_collection_cache(self) -> None:
        """Write the collection caches (the large maps) to `_cache_file`. Called
        at scan end, so the big write is infrequent."""
        now = time.time()
        # Snapshot under the cache lock so concurrent inserts can't corrupt the
        # iteration; serialization + file I/O happen outside it.
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
        self._atomic_write_json(self._cache_file, payload)

    def _save_id_cache(self) -> None:
        """Write the external-id maps to their own (small) file. Only *positive*
        resolutions are persisted: a cached None / fully-empty result is a
        negative kept in memory for the session but not on disk, so a title that
        gains an id later is re-checked after a restart instead of staying stale.
        """
        now = time.time()
        with self._cache_lock:
            for key in self._imdb_id_cache:
                self._imdb_id_cache_ts.setdefault(key, now)
            for key in self._tv_external_cache:
                self._tv_external_cache_ts.setdefault(key, now)
            imdb_snapshot = list(self._imdb_id_cache.items())
            tv_snapshot = list(self._tv_external_cache.items())
            imdb_ts = dict(self._imdb_id_cache_ts)
            tv_ts = dict(self._tv_external_cache_ts)

        payload: dict = {
            'version': 1,
            'imdb_ids': {
                str(key): {'value': value, 'at': imdb_ts.get(key, now)}
                for key, value in imdb_snapshot if value is not None
            },
            'tv_external': {
                str(key): {'value': value, 'at': tv_ts.get(key, now)}
                for key, value in tv_snapshot
                if value and (value.get('tvdbId') is not None or value.get('imdbId') is not None)
            },
        }
        self._atomic_write_json(self._id_cache_file, payload)

    def persist_caches(self) -> None:
        """Flush newly-resolved id maps to disk; no-op when nothing changed.

        Called by the Actors / IMDb-ratings endpoints after a batch of per-title
        /external_ids lookups so each resolved id survives a restart. Writes only
        the small id-cache file (not the collection cache). Clearing the dirty
        flag *before* the write means a concurrent insert that misses this
        snapshot re-arms it and is captured by the next call.
        """
        with self._cache_lock:
            if not self._id_cache_dirty:
                return
            self._id_cache_dirty = False
        self._save_id_cache()

    def test_api_key(self, api_key: str) -> tuple[bool, int]:
        url = f"{self._base_url}/configuration?api_key={api_key}"
        response = self._session.get(url, timeout=10)
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
                resp = self._session.get(
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
                resp = self._session.get(
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

    def _fetch_external_ids(self, media_type: str, tmdb_id: int) -> dict | None:
        """Single TMDB `/{movie|tv}/{id}/external_ids` call, shared by the movie
        and TV resolvers. Returns the parsed JSON, or None on any failure or
        non-200 — callers must treat None as "don't cache" so a transient error
        (e.g. a 429) never poisons the persisted cache with a wrong answer.
        """
        if not self._api_key:
            return None
        try:
            resp = self._session.get(
                f"{self._base_url}/{media_type}/{tmdb_id}/external_ids",
                params={"api_key": self._api_key},
                timeout=10,
            )
            if resp.status_code != 200:
                return None
            return resp.json()
        except (requests.exceptions.RequestException, ValueError) as e:
            logger.warning("Failed to fetch external ids for %s %s: %s", media_type, tmdb_id, e)
            return None

    def _resolve_external_batch(self, resolver, ids: list) -> list:
        """Run a single-id external-id resolver over a batch concurrently, then
        flush any newly-resolved ids to disk. The shared entry point for the
        Actors / IMDb-ratings endpoints so the worker cap and the persist call
        live here once instead of in each blueprint.
        """
        if not ids:
            return []
        with ThreadPoolExecutor(max_workers=_EXTERNAL_ID_WORKERS) as pool:
            results = list(pool.map(resolver, ids))
        self.persist_caches()
        return results

    def get_imdb_id(self, tmdb_id: int) -> str | None:
        """Resolve a TMDB movie ID to its IMDb ID (e.g. 'tt0133093'), cached.

        Backs the external-link toggle and IMDb ratings: TMDB's list/credit/
        collection responses don't carry IMDb IDs, so we look them up lazily per
        movie. Cached and persisted (see _save_id_cache) — IMDb IDs are
        stable, so each movie is resolved from TMDB once and reused thereafter.
        """
        if not tmdb_id:
            return None
        with self._cache_lock:
            if tmdb_id in self._imdb_id_cache:
                return self._imdb_id_cache[tmdb_id]
        data = self._fetch_external_ids("movie", tmdb_id)
        if data is None:
            return None
        imdb_id = data.get("imdb_id") or None
        with self._cache_lock:
            self._imdb_id_cache[tmdb_id] = imdb_id
            self._imdb_id_cache_ts[tmdb_id] = time.time()
            self._id_cache_dirty = True
        return imdb_id

    def get_imdb_ids(self, tmdb_ids: list[int]) -> list[str | None]:
        """Resolve a batch of TMDB movie IDs to IMDb IDs concurrently (order
        preserved), persisting any newly-resolved ids. Used by /api/imdb/ratings.
        """
        return self._resolve_external_batch(self.get_imdb_id, tmdb_ids)

    def _get_collection_id(self, api_key: str, tmdb_id: int) -> int | None:
        """Get the collection ID for a movie, using cache."""
        with self._cache_lock:
            if tmdb_id in self._movie_collection_cache:
                return self._movie_collection_cache[tmdb_id]

        coll_id: int | None = None
        try:
            resp = self._session.get(
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
            resp = self._session.get(
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
        owned_title_year: set[str] | None = None,
    ) -> list[dict]:
        """Build gap entry dicts from collection data.

        `owned_title_year` (a set of normalized `title|year` keys) is an optional
        fallback so an owned movie that lacks a TMDB id still counts as owned.
        The full scan resolves every owned movie into `owned_tmdb_ids` and doesn't
        need it; the incremental scan passes it so it can skip that resolve pass.
        """
        collection_name = coll_data.get("name", "Unknown Collection")
        entries = []
        for part in coll_data.get("parts", []):
            part_id = part["id"]
            is_owned = part_id in owned_tmdb_ids
            if not is_owned and owned_title_year:
                part_title = (part.get("title") or "").strip().lower()
                part_release = part.get("release_date") or ""
                part_year = part_release[:4] if part_release else ""
                if f"{part_title}|{part_year}" in owned_title_year:
                    is_owned = True
            if not show_existing and is_owned:
                continue
            # Drop low-tier missing movies at scan time (issue #47) so they're
            # excluded from the results — and from scheduled scans, which share
            # this path. Owned titles are never filtered; the user already has them.
            if not is_owned and not self._passes_quality_filter(part):
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
                "voteAverage": part.get("vote_average") or 0,
                "voteCount": part.get("vote_count") or 0,
                "genreIds": part.get("genre_ids") or [],
                "popularity": part.get("popularity") or 0,
            })
        return entries

    def _cached_parts_by_id(self) -> dict[int, dict]:
        """A {movie_id: part} index over every cached collection's `parts`.

        A gap is a *missing* movie (a collection member the user doesn't own), so
        its id is never a key in `_movie_collection_cache` (that maps *owned*
        movies to their collection) — but it does appear in its collection's
        `parts` list, poster and all. So hydration indexes the parts, not the
        owned-membership map. Caller holds `_cache_lock`."""
        parts: dict[int, dict] = {}
        for coll in self._collection_cache.values():
            for part in coll.get("parts", []):
                pid = part.get("id")
                if pid is not None:
                    parts.setdefault(pid, part)
        return parts

    def hydrate_gaps(self, gaps: list[dict]) -> list[dict]:
        """Re-attach display fields (poster, ratings, genres, release date) to a
        list of stored/stripped movie gaps by reading the warm collection cache —
        the same data a live scan builds, with no network calls. Used to reopen a
        saved scan (scan history) in the Missing view. A gap whose movie isn't in
        the cache (miss or expired TTL) is returned unchanged (its stored fields,
        poster None); the frontend's future-release filter falls back to the
        stored year, so the title still shows without a poster.
        """
        out = []
        with self._cache_lock:
            parts_by_id = self._cached_parts_by_id()
            for g in gaps:
                tmdb_id = g.get("tmdbId")
                part = parts_by_id.get(tmdb_id) if tmdb_id is not None else None
                if not part:
                    out.append(g)
                    continue
                poster = part.get("poster_path")
                release_date = part.get("release_date") or ""
                out.append({
                    "tmdbId": tmdb_id,
                    "name": part.get("title") or g.get("name", "Unknown"),
                    "year": release_date[:4] if release_date else g.get("year", "N/A"),
                    "releaseDate": release_date,
                    "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                    "overview": part.get("overview", ""),
                    "collectionName": g.get("collectionName", ""),
                    "owned": bool(g.get("owned", False)),
                    "voteAverage": part.get("vote_average") or 0,
                    "voteCount": part.get("vote_count") or 0,
                    "genreIds": part.get("genre_ids") or [],
                    "popularity": part.get("popularity") or 0,
                })
        return out

    @property
    def scan_progress(self) -> dict:
        return self._scan.snapshot

    @staticmethod
    def _movie_key(movie: dict) -> str:
        """Stable identity for an owned movie, used to diff the library between
        scans (incremental scan). Prefers the TMDB id; falls back to a normalized
        title|year so id-less movies still get a consistent key. Mirrors the
        dedup key the recommendations blueprint builds when merging libraries.
        """
        tmdb_id = movie.get('tmdbId')
        if tmdb_id:
            return f"tmdb:{tmdb_id}"
        name = (movie.get('name') or '').strip().lower()
        return f"ty:{name}|{movie.get('year') or ''}"

    def _load_incremental_prior(self, libraries: list[str]) -> dict | None:
        """Return the previous scan result if it can seed an incremental scan,
        else None (caller falls back to a full scan).

        Usable only when the persisted scan covered the *same* set of libraries
        and carries an `owned_keys` fingerprint — scans saved before this feature
        (no fingerprint) or for a different library selection can't be diffed.
        """
        prior = config_store.get('last_scan')
        if not isinstance(prior, dict):
            return None
        if not isinstance(prior.get('gaps'), list) or not isinstance(prior.get('owned_keys'), list):
            return None
        if set(prior.get('libraries') or []) != set(libraries):
            return None
        return prior

    def start_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
        library_names: list[str] | None = None,
        incremental: bool = False,
    ) -> bool:
        """Start a library scan in a background thread.

        When `incremental` is set and a compatible previous scan exists, only the
        movies added since that scan are looked up against TMDB and the result is
        merged into the prior gaps; otherwise a full scan runs. Returns whether
        the scan actually runs incrementally (False = fell back to a full scan).
        """
        libraries = list(library_names or [])
        prior = self._load_incremental_prior(libraries) if incremental else None
        generation = self._scan.begin(
            total=len(owned_movies),
            total_owned=len(owned_tmdb_ids),
            libraries=libraries,
        )
        thread = threading.Thread(
            target=self._run_scan,
            args=(api_key, owned_movies, owned_tmdb_ids, show_existing, libraries, generation, prior),
            daemon=True,
        )
        thread.start()
        return prior is not None

    def cancel_scan(self) -> bool:
        """Stop the running scan. Returns True if a scan was running."""
        return self._scan.cancel()

    def persist_last_scan(
        self,
        gaps: list[dict] | None,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        libraries: list[str],
        completed_at: str,
    ) -> None:
        """Persist the `last_scan` blob (+ the owned-library fingerprint used for
        incremental Update diffs). Shared by the manual background scan
        (`_run_scan`) and the scheduled scan so both leave identical state."""
        try:
            config_store.put('last_scan', {
                'gaps': gaps or [],
                'total_owned': len(owned_tmdb_ids),
                'libraries': list(libraries),
                'completed_at': completed_at,
                'owned_keys': [self._movie_key(m) for m in owned_movies],
            })
        except OSError as e:
            logger.warning("Failed to persist last_scan: %s", e)

    def _run_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool,
        libraries: list[str],
        generation: int,
        prior: dict | None = None,
    ) -> None:
        """Background scan worker. Runs the incremental finder when `prior` is
        supplied, otherwise a full scan; the result handling is identical."""
        try:
            if prior is not None:
                gaps, _ = self.find_collection_gaps_incremental(
                    api_key, owned_movies, owned_tmdb_ids, prior, show_existing, generation)
            else:
                gaps, _ = self.find_collection_gaps(api_key, owned_movies, owned_tmdb_ids, show_existing, generation)
            completed_at = datetime.now(timezone.utc).isoformat()
            final_gaps = gaps or []
            # A newer scan or a cancel superseded us — leave their state alone.
            if not self._scan.finish(generation, gaps=final_gaps,
                                     total_owned=len(owned_tmdb_ids), completed_at=completed_at):
                return
            self.persist_last_scan(final_gaps, owned_movies, owned_tmdb_ids, libraries, completed_at)
            missing_gaps = [g for g in final_gaps if not g.get('owned')]
            scan_history.record(
                media_type='movie',
                libraries=libraries,
                total_owned=len(owned_tmdb_ids),
                missing=len(missing_gaps),
                status='success',
                trigger='manual',
                completed_at=completed_at,
                gaps=missing_gaps,
            )
        except Exception as e:
            self._scan.fail(generation, str(e))
            scan_history.record(
                media_type='movie',
                libraries=libraries,
                total_owned=len(owned_tmdb_ids),
                missing=0,
                status='error',
                trigger='manual',
                message=str(e),
            )

    def find_collection_gaps(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
        generation: int | None = None,
    ) -> tuple[list[dict] | None, str | None]:
        """
        For each owned movie, check if it belongs to a TMDB collection.
        Then fetch the full collection and find movies not in the library.

        The per-movie collection lookups and per-collection fetches are the
        dominant cost of a cold scan, so both run concurrently over a thread pool
        (bounded by _EXTERNAL_ID_WORKERS); the shared keep-alive session reuses
        connections across them. All TMDB responses are cached, so a warm
        re-scan stays near-instant. Two phases: resolve every owned movie's id +
        collection first (completing ownership), then fetch the unique
        collections those touched and build gaps against the full owned set.
        """
        processed = {'n': 0}
        processed_lock = threading.Lock()

        def resolve_one(movie: dict):
            if not self._scan.is_current(generation):
                return None
            tmdb_id = self.resolve_tmdb_id(
                api_key,
                movie.get('tmdbId'),
                movie.get('imdbId'),
                movie.get('name'),
                movie.get('year'),
            )
            collection_id = self._get_collection_id(api_key, tmdb_id) if tmdb_id else None
            with processed_lock:
                processed['n'] += 1
                done = processed['n']
            self._scan.update(generation, processed=done, current_movie=movie.get('name', ''))
            return tmdb_id, collection_id

        # Phase 1: resolve ids + collection membership for every owned movie.
        with ThreadPoolExecutor(max_workers=_EXTERNAL_ID_WORKERS) as pool:
            results = list(pool.map(resolve_one, owned_movies))

        if not self._scan.is_current(generation):
            return [], None

        collection_ids: set[int] = set()
        for result in results:
            if not result:
                continue
            tmdb_id, collection_id = result
            if tmdb_id:
                owned_tmdb_ids.add(tmdb_id)
            if collection_id:
                collection_ids.add(collection_id)
        self._scan.update(generation, collections_found=len(collection_ids))

        # Phase 2: fetch the unique collections concurrently, then build gaps
        # against the now-complete owned set.
        def fetch_collection(collection_id: int):
            if not self._scan.is_current(generation):
                return None
            return self._get_collection(api_key, collection_id)

        with ThreadPoolExecutor(max_workers=_EXTERNAL_ID_WORKERS) as pool:
            coll_datas = list(pool.map(fetch_collection, collection_ids))

        gaps: list[dict] = []
        for coll_data in coll_datas:
            if coll_data:
                gaps.extend(self._build_gap_entries(coll_data, owned_tmdb_ids, show_existing))

        gaps.sort(key=lambda g: (g["collectionName"], g["year"]))
        self._save_collection_cache()
        return gaps, None

    def _removed_collection_id(self, key: str) -> int | None:
        """Collection id of a movie that was removed since the last scan, if we
        already know it from the persisted membership cache (no API call).

        Lets a deletion resurface its collection's gaps without a full rescan.
        Only id-keyed movies can be mapped; removed id-less (title|year) movies
        can't be resolved here and are reconciled by the ownership recompute in
        the merge (or, fully, by a later full scan).
        """
        if not key.startswith('tmdb:'):
            return None
        try:
            movie_id = int(key[5:])
        except ValueError:
            return None
        with self._cache_lock:
            return self._movie_collection_cache.get(movie_id)

    def find_collection_gaps_incremental(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        prior: dict,
        show_existing: bool = False,
        generation: int | None = None,
    ) -> tuple[list[dict] | None, str | None]:
        """Update the previous scan's gaps for the movies added/removed since.

        Every owned movie is resolved to a TMDB id (cheap when it already carries
        one) so ownership is complete, but only *newly added* movies pay the
        per-movie collection lookup — the dominant cost of a full scan. The
        collections those new (and any known removed) movies touch are rebuilt
        against the current library; gaps for untouched collections are carried
        over from `prior`, re-flagging ownership so filled gaps drop out and
        removed titles reappear. Collections are matched by name across runs
        (TMDB collection names are effectively unique).
        """
        prior_keys = set(prior.get('owned_keys') or [])
        prior_gaps = prior.get('gaps') or []
        current_keys = {self._movie_key(m) for m in owned_movies}

        # Title|year index of the whole owned library so rebuilt collections can
        # recognize an owned movie that lacks a TMDB id — without resolving every
        # old movie (the expensive part we're skipping). `owned_tmdb_ids` already
        # carries every owned movie that has a TMDB id (from the media server).
        owned_title_year: set[str] = set()
        for movie in owned_movies:
            name = (movie.get('name') or '').strip().lower()
            year = str(movie.get('year') or '')[:4]
            if name:
                owned_title_year.add(f"{name}|{year}")

        # Only the movies added since the last scan need a per-movie collection
        # lookup — that's what makes this fast. Progress reflects just that work.
        new_movies = [m for m in owned_movies if self._movie_key(m) not in prior_keys]
        self._scan.update(generation, total=len(new_movies), processed=0)

        affected_collection_ids: set[int] = set()
        for i, movie in enumerate(new_movies):
            if not self._scan.is_current(generation):
                break
            self._scan.update(generation, processed=i + 1, current_movie=movie.get('name', ''))

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
            if collection_id:
                affected_collection_ids.add(collection_id)

        # Re-check collections that lost a member since the last scan (only those
        # whose id we already know — see _removed_collection_id).
        for key in prior_keys - current_keys:
            removed_collection_id = self._removed_collection_id(key)
            if removed_collection_id:
                affected_collection_ids.add(removed_collection_id)

        self._scan.update(generation, collections_found=len(affected_collection_ids))

        # Rebuild only the affected collections against the current library.
        affected_names: set[str] = set()
        rebuilt: list[dict] = []
        for collection_id in affected_collection_ids:
            if not self._scan.is_current(generation):
                break
            coll_data = self._get_collection(api_key, collection_id)
            if not coll_data:
                continue
            affected_names.add(coll_data.get("name", "Unknown Collection"))
            rebuilt.extend(
                self._build_gap_entries(coll_data, owned_tmdb_ids, show_existing, owned_title_year))

        # Carry over prior gaps from untouched collections unchanged: if no movie
        # was added to or removed from a collection, its ownership can't have
        # changed since the prior scan, so its entries are still valid.
        merged: list[dict] = [g for g in prior_gaps if g.get("collectionName") not in affected_names]
        merged.extend(rebuilt)

        merged.sort(key=lambda g: (g["collectionName"], g["year"]))
        self._save_collection_cache()
        return merged, None

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

    # -- Actor / actress gaps (issue #49) --
    # Unlike collection gaps (a background scan of the whole library), an actor
    # lookup is search-driven and synchronous: search a person, fetch their
    # filmography, cross-reference owned movies. Mirrors find_gaps_for_movie.

    def _person_summary(self, person: dict) -> dict:
        """Map a TMDB person record to the compact shape the Actors UI uses."""
        known_for = [
            kf.get("title") or kf.get("name")
            for kf in (person.get("known_for") or [])
            if kf.get("title") or kf.get("name")
        ]
        profile = person.get("profile_path")
        return {
            "id": person["id"],
            "name": person.get("name", "Unknown"),
            "profileUrl": f"{self._image_base_url}{profile}" if profile else None,
            "knownFor": ", ".join(known_for[:3]),
            "popularity": person.get("popularity") or 0,
        }

    def search_people(self, query: str) -> list[dict]:
        """Search TMDB for people (actors/actresses) by name.

        TMDB's raw order can bury the recognizable actor under same-named crew, so
        we re-rank the page: exact name match first, then prefix match, then
        Acting-department people over directors/crew, then by popularity — keeping
        a precise match on top while breaking ties toward who the user likely means.
        """
        if not self._api_key or not query:
            return []
        try:
            resp = self._session.get(
                f"{self._base_url}/search/person",
                params={
                    "api_key": self._api_key,
                    "query": query,
                    "language": self._language,
                    "include_adult": "false",
                },
                timeout=10,
            )
            if resp.status_code != 200:
                return []
            results = resp.json().get("results", [])
        except Exception as e:
            logger.warning("TMDB person search failed for '%s': %s", query, e)
            return []

        q = query.strip().lower()

        def rank(person: dict):
            name = (person.get("name") or "").lower()
            return (
                name == q,                                        # exact match
                name.startswith(q),                               # prefix match
                person.get("known_for_department") == "Acting",   # actors over crew
                person.get("popularity") or 0,                    # popularity
            )

        results.sort(key=rank, reverse=True)
        return [self._person_summary(p) for p in results[:10] if p.get("id")]

    def _fetch_title_cast(self, media_type: str, title_id: int) -> list[dict]:
        """Cast list for a single movie/show (TMDB `/{media_type}/{id}/credits`)."""
        try:
            resp = self._session.get(
                f"{self._base_url}/{media_type}/{title_id}/credits",
                params={"api_key": self._api_key, "language": self._language},
                timeout=10,
            )
            if resp.status_code != 200:
                return []
            return resp.json().get("cast", []) or []
        except (requests.exceptions.RequestException, ValueError) as e:
            logger.warning("Failed to fetch %s %s credits: %s", media_type, title_id, e)
            return []

    def get_popular_people(self, media_type: str = 'movie',
                           force: bool = False) -> tuple[list[dict], float | None, float | None]:
        """Suggested actors for the empty search box, drawn from the top-billed
        cast of currently-popular *movies* or *TV shows* (matching the active tab),
        so the suggestions are on-topic and recognizable rather than TMDB's churny
        global `/person/popular` list. Ranked by how many popular titles a person
        appears in, then billing order, then popularity. `knownFor` shows the
        popular titles they're in. Cached in memory per media type for
        `_POPULAR_CACHE_TTL_SECONDS`; `force=True` bypasses the cache and rebuilds
        now (the manual "Refresh" button).

        Returns `(people, refreshed_at, next_refresh_at)`: `refreshed_at` is the
        Unix epoch the list was built and `next_refresh_at` when it becomes stale
        (`refreshed_at + TTL`), so the UI can show both; both `None` when nothing
        could be fetched. The cache is lazy — it rebuilds on the first request
        after `next_refresh_at`, not on a timer."""
        media_type = 'tv' if str(media_type).lower() == 'tv' else 'movie'
        now = time.time()
        if not force:
            with self._cache_lock:
                entry = self._popular_people_cache.get(media_type)
                if entry and now - entry['at'] < _POPULAR_CACHE_TTL_SECONDS:
                    return entry['people'], entry['at'], entry['at'] + _POPULAR_CACHE_TTL_SECONDS
        if not self._api_key:
            return [], None, None
        try:
            resp = self._session.get(
                f"{self._base_url}/{media_type}/popular",
                params={"api_key": self._api_key, "language": self._language},
                timeout=10,
            )
            if resp.status_code != 200:
                return [], None, None
            titles = [t for t in resp.json().get("results", [])[:12] if t.get("id")]
        except (requests.exceptions.RequestException, ValueError) as e:
            logger.warning("TMDB popular %s fetch failed: %s", media_type, e)
            return [], None, None

        title_ids = [t["id"] for t in titles]
        title_names = {t["id"]: (t.get("title") or t.get("name") or "") for t in titles}
        with ThreadPoolExecutor(max_workers=_EXTERNAL_ID_WORKERS) as pool:
            cast_lists = list(pool.map(lambda tid: self._fetch_title_cast(media_type, tid), title_ids))

        # Aggregate top-billed cast across the popular titles.
        agg: dict[int, dict] = {}
        for tid, cast in zip(title_ids, cast_lists):
            for member in cast[:10]:  # top-billed only
                pid = member.get("id")
                if not pid:
                    continue
                a = agg.get(pid)
                if a is None:
                    a = {"person": member, "titles": [], "count": 0, "best_order": 999}
                    agg[pid] = a
                a["count"] += 1
                a["best_order"] = min(a["best_order"], member.get("order") or 999)
                name = title_names.get(tid)
                if name and name not in a["titles"]:
                    a["titles"].append(name)

        ranked = sorted(
            agg.values(),
            key=lambda a: (a["count"], -a["best_order"], a["person"].get("popularity") or 0),
            reverse=True,
        )
        people = []
        for a in ranked[:12]:
            p = a["person"]
            profile = p.get("profile_path")
            people.append({
                "id": p["id"],
                "name": p.get("name", "Unknown"),
                "profileUrl": f"{self._image_base_url}{profile}" if profile else None,
                "knownFor": ", ".join(a["titles"][:3]),
                "popularity": p.get("popularity") or 0,
            })

        with self._cache_lock:
            self._popular_people_cache[media_type] = {"people": people, "at": now}
        return people, now, now + _POPULAR_CACHE_TTL_SECONDS

    def _get_person_movie_credits(self, person_id: int) -> dict | None:
        """Fetch a person's profile + movie & TV cast credits in one call, cached.

        The single /person call already returns bio/profile fields and both
        movie and TV credits, so we keep a `details` dict alongside the casts
        for the Actors page (movies or shows) — no extra API call needed.
        """
        with self._cache_lock:
            if person_id in self._person_credits_cache:
                return self._person_credits_cache[person_id]

        try:
            resp = self._session.get(
                f"{self._base_url}/person/{person_id}",
                params={
                    "api_key": self._api_key,
                    "language": self._language,
                    "append_to_response": "movie_credits,tv_credits",
                },
                timeout=10,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
        except Exception as e:
            logger.warning("Failed to fetch person %s credits: %s", person_id, e)
            return None

        profile = data.get("profile_path")
        credits = {
            "actor_name": data.get("name", "Unknown"),
            "cast": (data.get("movie_credits") or {}).get("cast", []),
            "tv_cast": (data.get("tv_credits") or {}).get("cast", []),
            "details": {
                "id": person_id,
                "name": data.get("name", "Unknown"),
                "profileUrl": f"{self._image_base_url}{profile}" if profile else None,
                "biography": data.get("biography") or "",
                "birthday": data.get("birthday"),
                "deathday": data.get("deathday"),
                "placeOfBirth": data.get("place_of_birth"),
                "knownForDepartment": data.get("known_for_department"),
                "imdbId": data.get("imdb_id"),
            },
        }
        with self._cache_lock:
            self._person_credits_cache[person_id] = credits
        return credits

    def get_person_details(self, person_id: int) -> dict | None:
        """Profile info (photo, bio, born) for the Actors page header, cached."""
        credits = self._get_person_movie_credits(person_id)
        return credits.get("details") if credits else None

    def get_movie_genres(self) -> list[dict]:
        """TMDB's movie genre id→name list, cached in-memory (small, static)."""
        with self._cache_lock:
            if self._genre_cache is not None:
                return self._genre_cache
        if not self._api_key:
            return []
        genres: list[dict] = []
        try:
            resp = self._session.get(
                f"{self._base_url}/genre/movie/list",
                params={"api_key": self._api_key, "language": self._language},
                timeout=10,
            )
            if resp.status_code == 200:
                genres = resp.json().get("genres", [])
        except Exception as e:
            logger.warning("Failed to fetch TMDB genres: %s", e)
            return []
        with self._cache_lock:
            self._genre_cache = genres
        return genres

    def _is_minor_credit(self, credit: dict, release_date: str) -> bool:
        """Whether a credit is bonus content rather than a real acting role.

        Featurettes, DVD extras, "making-of" docs, and "as themselves" tribute /
        talk-show appearances pollute TMDB's movie_credits cast list. We hide
        these by default so an actor's filmography reads as actual films.
        """
        # Undated credits (no release date at all) are unconfirmed /
        # in-development / rumored projects — not a dated upcoming film.
        if not release_date:
            return True
        if credit.get("video"):
            return True
        character = (credit.get("character") or "")
        if "uncredited" in character.lower() or _SELF_APPEARANCE_RE.search(character):
            return True
        if _MINOR_GENRE_IDS.intersection(credit.get("genre_ids") or []):
            return True
        # Obscure, already-released titles with almost no votes are typically
        # extras; unreleased real films (0 votes yet) are exempt.
        if self._is_released(release_date) and (credit.get("vote_count") or 0) < _MINOR_VOTE_THRESHOLD:
            return True
        return False

    def _build_actor_gap_entries(
        self,
        cast: list[dict],
        actor_name: str,
        owned_tmdb_ids: set[int],
        owned_title_year: set[str],
        show_existing: bool,
        include_minor: bool = False,
    ) -> list[dict]:
        """Build gap entries from an actor's cast credits (one per movie).

        Mirrors `_build_gap_entries`, using the actor's name as the group
        (`collectionName`) so the frontend Gap normalization, export, and Radarr
        all work unchanged. No rating quality filter — a filmography is bounded;
        owned/future/ignore are client-side toggles. Bonus content (featurettes,
        making-of, "as themselves") is dropped unless `include_minor` is set, and
        owned titles are always kept regardless.
        """
        entries = []
        seen: set[int] = set()
        for credit in cast:
            movie_id = credit.get("id")
            if not movie_id or movie_id in seen:
                continue
            if credit.get("adult"):
                continue
            title = credit.get("title") or credit.get("original_title")
            if not title:
                continue
            seen.add(movie_id)

            release_date = credit.get("release_date") or ""
            year = release_date[:4] if release_date else "N/A"
            # Cheap fallback for owned movies that lack a TMDB guid.
            name_key = f"{title.strip().lower()}|{year if year != 'N/A' else ''}"
            is_owned = movie_id in owned_tmdb_ids or name_key in owned_title_year

            # Hide bonus content by default, but never hide something you own.
            if not is_owned and not include_minor and self._is_minor_credit(credit, release_date):
                continue
            if not show_existing and is_owned:
                continue

            poster = credit.get("poster_path")
            entries.append({
                "tmdbId": movie_id,
                "name": title,
                "year": year,
                "releaseDate": release_date,
                "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                "overview": credit.get("overview", ""),
                "collectionName": actor_name,
                "owned": is_owned,
                "voteAverage": credit.get("vote_average") or 0,
                "voteCount": credit.get("vote_count") or 0,
                "genreIds": credit.get("genre_ids") or [],
                "popularity": credit.get("popularity") or 0,
            })
        return entries

    def get_actor_gaps(
        self,
        person_id: int,
        owned_tmdb_ids: set[int],
        owned_movies: list[dict] | None = None,
        show_existing: bool = True,
        include_minor: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """Find owned/missing movies for an actor's cast filmography.

        By default, bonus content (featurettes, making-of docs, "as themselves"
        appearances) is excluded; pass include_minor=True to include it.
        """
        if not self._api_key:
            return None, "No TMDB API key configured"

        credits = self._get_person_movie_credits(person_id)
        if credits is None:
            return None, "Failed to fetch the actor's filmography"

        # Cheap title|year index so owned movies lacking a TMDB guid still match.
        owned_title_year: set[str] = set()
        for movie in owned_movies or []:
            name = (movie.get("name") or "").strip().lower()
            year = str(movie.get("year") or "")[:4]
            if name:
                owned_title_year.add(f"{name}|{year}")

        entries = self._build_actor_gap_entries(
            credits.get("cast", []),
            credits.get("actor_name", "Unknown"),
            owned_tmdb_ids,
            owned_title_year,
            show_existing,
            include_minor,
        )
        # Chronological, with undated titles last.
        entries.sort(key=lambda e: (e["year"] == "N/A", e["year"]))
        return entries, None

    # -- Actor / actress TV gaps --
    # The TV counterpart of get_actor_gaps: an actor's TV credits cross-checked
    # against owned shows. TheTVDB ids (for Sonarr / the ignore list) are
    # resolved by the caller from the returned tmdbId, lazily and cached.

    def _build_actor_tv_gap_entries(
        self,
        tv_cast: list[dict],
        actor_name: str,
        owned_tmdb_ids: set[int],
        owned_title_year: set[str],
        show_existing: bool,
        include_minor: bool = False,
    ) -> list[dict]:
        """Build TV gap entries from an actor's TV cast credits (one per show)."""
        entries = []
        seen: set[int] = set()
        for credit in tv_cast:
            show_id = credit.get("id")
            if not show_id or show_id in seen:
                continue
            if credit.get("adult"):
                continue
            name = credit.get("name") or credit.get("original_name")
            if not name:
                continue
            seen.add(show_id)

            air_date = credit.get("first_air_date") or ""
            year = air_date[:4] if air_date else "N/A"
            name_key = f"{name.strip().lower()}|{year if year != 'N/A' else ''}"
            is_owned = show_id in owned_tmdb_ids or name_key in owned_title_year

            if not is_owned and not include_minor and self._is_minor_credit(credit, air_date):
                continue
            if not show_existing and is_owned:
                continue

            poster = credit.get("poster_path")
            entries.append({
                "tmdbId": show_id,
                "name": name,
                "year": year,
                "releaseDate": air_date,
                "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                "overview": credit.get("overview", ""),
                "collectionName": actor_name,
                "owned": is_owned,
                "voteAverage": credit.get("vote_average") or 0,
                "voteCount": credit.get("vote_count") or 0,
                "genreIds": credit.get("genre_ids") or [],
                "popularity": credit.get("popularity") or 0,
            })
        return entries

    def get_actor_tv_gaps(
        self,
        person_id: int,
        owned_tmdb_ids: set[int],
        owned_shows: list[dict] | None = None,
        show_existing: bool = True,
        include_minor: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """Find owned/missing TV shows for an actor's TV credits.

        Entries carry the TMDB show id; the caller resolves TheTVDB ids from it.
        """
        if not self._api_key:
            return None, "No TMDB API key configured"

        credits = self._get_person_movie_credits(person_id)
        if credits is None:
            return None, "Failed to fetch the actor's filmography"

        owned_title_year: set[str] = set()
        for show in owned_shows or []:
            name = (show.get("name") or "").strip().lower()
            year = str(show.get("year") or "")[:4]
            if name:
                owned_title_year.add(f"{name}|{year}")

        entries = self._build_actor_tv_gap_entries(
            credits.get("tv_cast", []),
            credits.get("actor_name", "Unknown"),
            owned_tmdb_ids,
            owned_title_year,
            show_existing,
            include_minor,
        )
        entries.sort(key=lambda e: (e["year"] == "N/A", e["year"]))
        return entries, None

    def get_tv_external_ids(self, tmdb_tv_id: int) -> dict:
        """Resolve a TMDB TV id to {tvdbId, imdbId}, cached.

        TheTVDB id powers Sonarr / the ignore list / links; the IMDb id lets us
        show IMDb ratings for shows. Both come from one external_ids call.
        """
        empty = {"tvdbId": None, "imdbId": None}
        if not tmdb_tv_id:
            return empty
        with self._cache_lock:
            if tmdb_tv_id in self._tv_external_cache:
                return self._tv_external_cache[tmdb_tv_id]
        data = self._fetch_external_ids("tv", tmdb_tv_id)
        if data is None:
            return empty
        try:
            raw_tvdb = data.get("tvdb_id")
            result = {
                "tvdbId": int(raw_tvdb) if raw_tvdb else None,
                "imdbId": data.get("imdb_id") or None,
            }
        except (ValueError, TypeError) as e:
            logger.warning("Bad tvdb_id for TMDB show %s: %s", tmdb_tv_id, e)
            return empty
        with self._cache_lock:
            self._tv_external_cache[tmdb_tv_id] = result
            self._tv_external_cache_ts[tmdb_tv_id] = time.time()
            self._id_cache_dirty = True
        return result

    def get_tv_external_ids_batch(self, tmdb_tv_ids: list[int]) -> list[dict]:
        """Resolve a batch of TMDB TV ids to {tvdbId, imdbId} concurrently (order
        preserved), persisting any newly-resolved ids. Used by actor TV gaps.
        """
        return self._resolve_external_batch(self.get_tv_external_ids, tmdb_tv_ids)
