import requests
from app.services import config_store


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
        self._api_key: str | None = config_store.get('tmdb_api_key')

        # In-memory caches to avoid redundant TMDB API calls
        # Maps (imdb_id or "title|year") -> resolved TMDB ID
        self._id_cache: dict[str, int | None] = {}
        # Maps tmdb_id -> collection_id (or None if no collection)
        self._movie_collection_cache: dict[int, int | None] = {}
        # Maps collection_id -> full collection data dict
        self._collection_cache: dict[int, dict] = {}

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def clear_cache(self) -> None:
        """Clear all TMDB response caches for a fresh scan."""
        self._id_cache.clear()
        self._movie_collection_cache.clear()
        self._collection_cache.clear()

    def test_api_key(self, api_key: str) -> tuple[bool, int]:
        url = f"{self._base_url}/configuration?api_key={api_key}"
        response = requests.get(url)
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
            if cache_key in self._id_cache:
                return self._id_cache[cache_key]
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
                        self._id_cache[cache_key] = resolved
                        return resolved
            except Exception:
                pass
            self._id_cache[cache_key] = None

        # 3. Try title + year search (cached)
        if title:
            cache_key = f"search:{title.lower()}|{year}"
            if cache_key in self._id_cache:
                return self._id_cache[cache_key]
            try:
                params = {"api_key": api_key, "query": title}
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
                        self._id_cache[cache_key] = resolved
                        return resolved
            except Exception:
                pass
            self._id_cache[cache_key] = None

        return None

    def _get_collection_id(self, api_key: str, tmdb_id: int) -> int | None:
        """Get the collection ID for a movie, using cache."""
        if tmdb_id in self._movie_collection_cache:
            return self._movie_collection_cache[tmdb_id]

        try:
            resp = requests.get(
                f"{self._base_url}/movie/{tmdb_id}",
                params={"api_key": api_key},
                timeout=10,
            )
            if resp.status_code != 200:
                self._movie_collection_cache[tmdb_id] = None
                return None

            collection = resp.json().get("belongs_to_collection")
            coll_id = collection["id"] if collection else None
            self._movie_collection_cache[tmdb_id] = coll_id
            return coll_id
        except Exception:
            self._movie_collection_cache[tmdb_id] = None
            return None

    def _get_collection(self, api_key: str, collection_id: int) -> dict | None:
        """Fetch full collection data, using cache."""
        if collection_id in self._collection_cache:
            return self._collection_cache[collection_id]

        try:
            resp = requests.get(
                f"{self._base_url}/collection/{collection_id}",
                params={"api_key": api_key},
                timeout=10,
            )
            if resp.status_code != 200:
                return None

            data = resp.json()
            self._collection_cache[collection_id] = data
            return data
        except Exception:
            return None

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
            entries.append({
                "tmdbId": part_id,
                "name": part.get("title", "Unknown"),
                "year": part.get("release_date", "")[:4] if part.get("release_date") else "N/A",
                "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                "overview": part.get("overview", ""),
                "collectionName": collection_name,
                "owned": is_owned,
            })
        return entries

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

        for movie in owned_movies:
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

            coll_data = self._get_collection(api_key, collection_id)
            if not coll_data:
                continue

            gaps.extend(self._build_gap_entries(coll_data, owned_tmdb_ids, show_existing))

        gaps.sort(key=lambda g: (g["collectionName"], g["year"]))
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
