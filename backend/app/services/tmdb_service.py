import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
import requests
from app.services import config_store, scan_history
from app.services.scan_progress import ScanProgressTracker

logger = logging.getLogger(__name__)

_CACHE_FILE_NAME = 'tmdb_cache.json'

# Heuristics for decluttering an actor's filmography (issue #49): TMDB's
# movie_credits cast list mixes real acting roles with DVD extras, featurettes,
# "making-of" docs, and "as themselves" tribute/talk-show appearances. These
# signals flag the latter so they're hidden by default (revealable via a toggle).
_DOCUMENTARY_GENRE_ID = 99
_MINOR_VOTE_THRESHOLD = 10
# Word-boundary match so "Self/Himself/Herself" credits are caught without
# nuking real characters that merely contain the letters (e.g. "Selfridge").
_SELF_APPEARANCE_RE = re.compile(r"\b(self|himself|herself|themselves)\b", re.IGNORECASE)
# Collection memberships rarely change but new movies can be added to existing
# collections (sequels, reissues), so re-fetch weekly to balance freshness vs.
# TMDB rate limits.
_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
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
        # Movie -> IMDb ID lookups for external links. Not persisted — IMDb IDs
        # are stable and resolved lazily via a single TMDB call.
        self._imdb_id_cache: dict[int, str | None] = {}

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

    def get_imdb_id(self, tmdb_id: int) -> str | None:
        """Resolve a TMDB movie ID to its IMDb ID (e.g. 'tt0133093'), cached.

        Backs the external-link toggle: poster/title clicks can
        point to IMDb instead of TMDB. TMDB's list/credit/collection responses
        don't carry IMDb IDs, so we look them up lazily per movie on demand.
        Cached in-memory only — IMDb IDs are stable and these are cheap single
        calls to regenerate after a restart.
        """
        if not tmdb_id:
            return None
        with self._cache_lock:
            if tmdb_id in self._imdb_id_cache:
                return self._imdb_id_cache[tmdb_id]
        if not self._api_key:
            return None
        imdb_id: str | None = None
        try:
            resp = requests.get(
                f"{self._base_url}/movie/{tmdb_id}/external_ids",
                params={"api_key": self._api_key},
                timeout=10,
            )
            if resp.status_code == 200:
                imdb_id = resp.json().get("imdb_id") or None
        except Exception as e:
            logger.warning("Failed to fetch IMDb ID for TMDB movie %s: %s", tmdb_id, e)
            return None
        with self._cache_lock:
            self._imdb_id_cache[tmdb_id] = imdb_id
        return imdb_id

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
            })
        return entries

    @property
    def scan_progress(self) -> dict:
        return self._scan.snapshot

    def start_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
        library_names: list[str] | None = None,
    ) -> None:
        """Start a library scan in a background thread."""
        libraries = list(library_names or [])
        generation = self._scan.begin(
            total=len(owned_movies),
            total_owned=len(owned_tmdb_ids),
            libraries=libraries,
        )
        thread = threading.Thread(
            target=self._run_scan,
            args=(api_key, owned_movies, owned_tmdb_ids, show_existing, libraries, generation),
            daemon=True,
        )
        thread.start()

    def cancel_scan(self) -> bool:
        """Stop the running scan. Returns True if a scan was running."""
        return self._scan.cancel()

    def _run_scan(
        self,
        api_key: str,
        owned_movies: list[dict],
        owned_tmdb_ids: set[int],
        show_existing: bool,
        libraries: list[str],
        generation: int,
    ) -> None:
        """Background scan worker."""
        try:
            gaps, _ = self.find_collection_gaps(api_key, owned_movies, owned_tmdb_ids, show_existing, generation)
            completed_at = datetime.now(timezone.utc).isoformat()
            final_gaps = gaps or []
            # A newer scan or a cancel superseded us — leave their state alone.
            if not self._scan.finish(generation, gaps=final_gaps,
                                     total_owned=len(owned_tmdb_ids), completed_at=completed_at):
                return
            try:
                config_store.put('last_scan', {
                    'gaps': final_gaps,
                    'total_owned': len(owned_tmdb_ids),
                    'libraries': libraries,
                    'completed_at': completed_at,
                })
            except OSError as e:
                logger.warning("Failed to persist last_scan: %s", e)
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

        All TMDB responses are cached so repeat scans are near-instant.
        """
        seen_collections: set[int] = set()
        gaps = []
        total = len(owned_movies)

        for i, movie in enumerate(owned_movies):
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
            if not collection_id or collection_id in seen_collections:
                continue
            seen_collections.add(collection_id)
            self._scan.update(generation, collections_found=len(seen_collections))

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

    # -- Actor / actress gaps (issue #49) --
    # Unlike collection gaps (a background scan of the whole library), an actor
    # lookup is search-driven and synchronous: search a person, fetch their
    # filmography, cross-reference owned movies. Mirrors find_gaps_for_movie.

    def search_people(self, query: str) -> list[dict]:
        """Search TMDB for people (actors/actresses) by name."""
        if not self._api_key or not query:
            return []
        try:
            resp = requests.get(
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

        people = []
        for person in results[:10]:
            known_for = [
                kf.get("title") or kf.get("name")
                for kf in (person.get("known_for") or [])
                if kf.get("title") or kf.get("name")
            ]
            profile = person.get("profile_path")
            people.append({
                "id": person["id"],
                "name": person.get("name", "Unknown"),
                "profileUrl": f"{self._image_base_url}{profile}" if profile else None,
                "knownFor": ", ".join(known_for[:3]),
            })
        return people

    def _get_person_movie_credits(self, person_id: int) -> dict | None:
        """Fetch a person's name + movie cast credits in one call, using cache."""
        with self._cache_lock:
            if person_id in self._person_credits_cache:
                return self._person_credits_cache[person_id]

        try:
            resp = requests.get(
                f"{self._base_url}/person/{person_id}",
                params={
                    "api_key": self._api_key,
                    "language": self._language,
                    "append_to_response": "movie_credits",
                },
                timeout=10,
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
        except Exception as e:
            logger.warning("Failed to fetch person %s credits: %s", person_id, e)
            return None

        credits = {
            "actor_name": data.get("name", "Unknown"),
            "cast": (data.get("movie_credits") or {}).get("cast", []),
        }
        with self._cache_lock:
            self._person_credits_cache[person_id] = credits
        return credits

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
        if _DOCUMENTARY_GENRE_ID in (credit.get("genre_ids") or []):
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
