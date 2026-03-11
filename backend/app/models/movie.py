from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Movie:
    name: str
    year: int | str
    overview: str
    poster_url: str
    imdb_id: Optional[str] = None
    tmdb_id: Optional[int] = None
    tvdb_id: Optional[str] = None

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
