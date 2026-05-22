from dataclasses import dataclass
from typing import Optional


@dataclass
class Show:
    name: str
    year: int | str
    overview: str
    poster_url: str
    imdb_id: Optional[str] = None
    tmdb_id: Optional[int] = None
    # TheTVDB series ID — numeric, used for franchise gap-finding (issue #10).
    tvdb_id: Optional[int] = None

    def to_dict(self) -> dict:
        return {
            'name': self.name,
            'year': self.year,
            'overview': self.overview,
            'posterUrl': self.poster_url,
            'imdbId': self.imdb_id,
            'tmdbId': self.tmdb_id,
            'tvdbId': self.tvdb_id,
        }
