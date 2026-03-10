export interface Movie {
  name: string;
  year: number | string;
  overview: string;
  posterUrl: string;
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: string;
}
