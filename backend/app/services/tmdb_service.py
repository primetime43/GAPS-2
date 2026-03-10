import requests


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
        self._api_key: str | None = None

    @property
    def api_key(self) -> str | None:
        return self._api_key

    def test_api_key(self, api_key: str) -> tuple[bool, int]:
        url = f"{self._base_url}/configuration?api_key={api_key}"
        response = requests.get(url)
        return response.status_code == 200, response.status_code

    def save_api_key(self, api_key: str) -> tuple[bool, int]:
        valid, status_code = self.test_api_key(api_key)
        if valid:
            self._api_key = api_key
        return valid, status_code

    def find_collection_gaps(
        self,
        api_key: str,
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """
        For each owned movie, check if it belongs to a TMDB collection.
        Then fetch the full collection and find movies not in the library.
        Returns a list of missing movies grouped by collection.
        """
        seen_collections: dict[int, dict] = {}  # collection_id -> collection data
        gaps = []

        for tmdb_id in owned_tmdb_ids:
            # Get movie details to find its collection
            movie_resp = requests.get(
                f"{self._base_url}/movie/{tmdb_id}",
                params={"api_key": api_key},
                timeout=10,
            )
            if movie_resp.status_code != 200:
                continue

            movie_data = movie_resp.json()
            collection = movie_data.get("belongs_to_collection")
            if not collection:
                continue

            collection_id = collection["id"]
            if collection_id in seen_collections:
                continue

            # Fetch the full collection
            coll_resp = requests.get(
                f"{self._base_url}/collection/{collection_id}",
                params={"api_key": api_key},
                timeout=10,
            )
            if coll_resp.status_code != 200:
                continue

            coll_data = coll_resp.json()
            seen_collections[collection_id] = coll_data

            collection_name = coll_data.get("name", "Unknown Collection")
            parts = coll_data.get("parts", [])

            for part in parts:
                part_id = part["id"]
                is_owned = part_id in owned_tmdb_ids

                if not show_existing and is_owned:
                    continue

                poster = part.get("poster_path")
                gaps.append({
                    "tmdbId": part_id,
                    "name": part.get("title", "Unknown"),
                    "year": part.get("release_date", "")[:4] if part.get("release_date") else "N/A",
                    "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                    "overview": part.get("overview", ""),
                    "collectionName": collection_name,
                    "owned": is_owned,
                })

        # Sort: by collection name, then by year within each collection
        gaps.sort(key=lambda g: (g["collectionName"], g["year"]))

        return gaps, None

    def find_gaps_for_movie(
        self,
        api_key: str,
        tmdb_id: int,
        owned_tmdb_ids: set[int],
        show_existing: bool = False,
    ) -> tuple[list[dict] | None, str | None]:
        """Find collection gaps for a single movie."""
        movie_resp = requests.get(
            f"{self._base_url}/movie/{tmdb_id}",
            params={"api_key": api_key},
            timeout=10,
        )
        if movie_resp.status_code != 200:
            return None, f"Failed to fetch movie details (status {movie_resp.status_code})"

        movie_data = movie_resp.json()
        collection = movie_data.get("belongs_to_collection")
        if not collection:
            return [], None  # Movie doesn't belong to a collection

        coll_resp = requests.get(
            f"{self._base_url}/collection/{collection['id']}",
            params={"api_key": api_key},
            timeout=10,
        )
        if coll_resp.status_code != 200:
            return None, "Failed to fetch collection details"

        coll_data = coll_resp.json()
        collection_name = coll_data.get("name", "Unknown Collection")
        results = []

        for part in coll_data.get("parts", []):
            part_id = part["id"]
            is_owned = part_id in owned_tmdb_ids

            if not show_existing and is_owned:
                continue

            poster = part.get("poster_path")
            results.append({
                "tmdbId": part_id,
                "name": part.get("title", "Unknown"),
                "year": part.get("release_date", "")[:4] if part.get("release_date") else "N/A",
                "posterUrl": f"{self._image_base_url}{poster}" if poster else None,
                "overview": part.get("overview", ""),
                "collectionName": collection_name,
                "owned": is_owned,
            })

        results.sort(key=lambda r: r["year"])
        return results, None
