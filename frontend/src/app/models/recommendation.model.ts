export interface CollectionGap {
  tmdbId: number;
  name: string;
  year: string;
  releaseDate?: string;
  posterUrl: string | null;
  overview: string;
  collectionName: string;
  owned: boolean;
  voteAverage?: number;
  voteCount?: number;
  genreIds?: number[];
  popularity?: number;
}

/**
 * Normalized gap used by the unified Missing view for both movies (TMDB
 * collections) and TV shows (TheTVDB franchises).
 */
export interface Gap {
  id: number;            // tmdbId for movies, tvdbId for shows
  name: string;
  year: string | number;
  releaseDate?: string;  // movies only; used for "hide future releases"
  posterUrl: string | null;
  overview: string;
  groupName: string;     // collection name (movies) or franchise name (TV)
  owned: boolean;
  externalUrl: string;   // TMDB or TheTVDB page for the title
  radarrEligible: boolean; // movies → Radarr
  sonarrEligible: boolean; // shows → Sonarr
  imdbRating?: number;     // IMDb aggregate rating (movies, when enabled)
  imdbVotes?: number;      // IMDb vote count
  tmdbRating?: number;     // TMDB vote average (movies)
  tmdbVotes?: number;      // TMDB vote count (movies)
  genreIds?: number[];     // TMDB genre ids (movies) — used by the genre filter
  popularity?: number;     // TMDB popularity — used by the sort control
  tmdbId?: number;         // TMDB id (TV gaps key on tvdbId, so id alone isn't it)
  imdbId?: string;         // IMDb id, when known (TV) — for building IMDb links
}
