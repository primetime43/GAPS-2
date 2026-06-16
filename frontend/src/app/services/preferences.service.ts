import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UserPreferences {
  defaultLibrary: string;
  moviesPerPage: number;
  hideOwnedByDefault: boolean;
  hideFutureReleasesByDefault: boolean;
  language: string;
  port: number;
  autoOpenBrowser: boolean;
  posterPrefetch: boolean;
  imageCacheEnabled: boolean;
  mediaServerTimeout: number;
  qualityFilterEnabled: boolean;
  minRating: number;
  minVoteCount: number;
  externalLinkProvider: 'tmdb' | 'imdb';
  showImdbRatings: boolean;
  showTmdbRatings: boolean;
}

/**
 * Single frontend source of truth for preference defaults. Mirrors the backend
 * `DEFAULTS` in `backend/app/blueprints/preferences.py` — keep the two in sync
 * when adding a preference. Spread it (`{ ...DEFAULT_PREFERENCES }`) for a fresh
 * mutable copy.
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultLibrary: '',
  moviesPerPage: 50,
  hideOwnedByDefault: false,
  hideFutureReleasesByDefault: false,
  language: 'en',
  port: 4277,
  autoOpenBrowser: true,
  posterPrefetch: false,
  imageCacheEnabled: false,
  mediaServerTimeout: 30,
  qualityFilterEnabled: false,
  minRating: 0,
  minVoteCount: 0,
  externalLinkProvider: 'tmdb',
  showImdbRatings: false,
  showTmdbRatings: true,
};

@Injectable({
  providedIn: 'root'
})
export class PreferencesService {

  constructor(private http: HttpClient) {}

  load(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(`${environment.apiUrl}/preferences`);
  }

  save(prefs: Partial<UserPreferences>): Observable<UserPreferences> {
    return this.http.post<UserPreferences>(`${environment.apiUrl}/preferences`, prefs);
  }
}
