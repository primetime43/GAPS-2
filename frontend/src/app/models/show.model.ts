export interface Show {
  name: string;
  year: number | string;
  overview: string;
  posterUrl: string;
  imdbId?: string;
  tmdbId?: number;
  // TheTVDB series ID — numeric, unlike a movie's string tvdbId.
  tvdbId?: number;
}
