import requests


class TmdbService:
    def __init__(self, base_url: str, image_base_url: str):
        self._base_url = base_url
        self._image_base_url = image_base_url
        self._api_key: str | None = None

    def test_api_key(self, api_key: str) -> tuple[bool, int]:
        url = f"{self._base_url}/configuration?api_key={api_key}"
        response = requests.get(url)
        return response.status_code == 200, response.status_code

    def save_api_key(self, api_key: str) -> tuple[bool, int]:
        valid, status_code = self.test_api_key(api_key)
        if valid:
            self._api_key = api_key
        return valid, status_code

    def get_recommendations(
        self,
        movie_id: int,
        api_key: str,
        library_name: str,
        show_existing: bool,
        movies_cache: dict,
    ) -> tuple[list[dict] | None, str | None]:
        url = f"{self._base_url}/movie/{movie_id}/recommendations"
        params = {"api_key": api_key}
        response = requests.get(url, params=params)

        if response.status_code != 200:
            return None, f"API request failed with status code {response.status_code}"

        data = response.json()

        if not show_existing:
            library = movies_cache.get(library_name, {'tmdbIds': []})
            existing_tmdb_ids = set(library.get('tmdbIds', []))
        else:
            existing_tmdb_ids = set()

        recommendations = []
        for item in data.get('results', []):
            if item['id'] not in existing_tmdb_ids:
                poster = item.get('poster_path')
                recommendations.append({
                    'tmdbId': item['id'],
                    'name': item['title'],
                    'year': item['release_date'][:4] if item.get('release_date') else 'N/A',
                    'posterUrl': f"{self._image_base_url}{poster}" if poster else 'N/A',
                    'overview': item.get('overview', 'N/A'),
                })

        return recommendations, None
