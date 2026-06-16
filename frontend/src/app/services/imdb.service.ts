import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ImdbConfig {
  datasetUrl: string;
}

export interface ImdbStatus extends ImdbConfig {
  ready: boolean;
  titleCount: number;
  updatedAt: string | null;
  building: boolean;
  error: string | null;
}

export interface ImdbRating {
  imdbId: string;
  aggregateRating: number;
  voteCount: number;
}

/** IMDb ratings via IMDb's free official dataset (datasets.imdbws.com). */
@Injectable({ providedIn: 'root' })
export class ImdbService {
  constructor(private http: HttpClient) {}

  getConfig(): Observable<ImdbConfig> {
    return this.http.get<ImdbConfig>(`${environment.apiUrl}/imdb/config`);
  }

  saveConfig(config: Partial<ImdbConfig>): Observable<ImdbConfig> {
    return this.http.post<ImdbConfig>(`${environment.apiUrl}/imdb/config`, config);
  }

  getStatus(): Observable<ImdbStatus> {
    return this.http.get<ImdbStatus>(`${environment.apiUrl}/imdb/status`);
  }

  /** Trigger a background download/rebuild of the ratings dataset. */
  refresh(): Observable<ImdbStatus> {
    return this.http.post<ImdbStatus>(`${environment.apiUrl}/imdb/refresh`, {});
  }

  /** Resolve IMDb ratings for movies, keyed by TMDB id (as a string). */
  getRatings(tmdbIds: number[]): Observable<{ ratings: Record<string, ImdbRating> }> {
    return this.http.post<{ ratings: Record<string, ImdbRating> }>(
      `${environment.apiUrl}/imdb/ratings`, { tmdbIds }
    );
  }
}
