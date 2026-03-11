import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CollectionGap } from '../models/recommendation.model';
import { Movie } from '../models/movie.model';

export interface ScanProgress {
  status: 'idle' | 'scanning' | 'done' | 'error';
  processed: number;
  total: number;
  current_movie: string;
  collections_found: number;
  gaps: CollectionGap[];
  total_owned: number;
  error: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class RecommendationService {

  constructor(private http: HttpClient) {}

  getGapsForMovie(
    movie: Movie,
    libraryName: string,
    showExisting: boolean,
    source: string = 'plex'
  ): Observable<CollectionGap[]> {
    let params = new HttpParams()
      .set('libraryName', libraryName)
      .set('showExisting', showExisting.toString())
      .set('source', source);

    if (movie.tmdbId) {
      params = params.set('movieId', movie.tmdbId.toString());
    }
    if (movie.imdbId) {
      params = params.set('imdbId', movie.imdbId);
    }
    if (movie.name) {
      params = params.set('title', movie.name);
    }
    if (movie.year) {
      params = params.set('year', movie.year.toString());
    }

    return this.http.get<{ gaps: CollectionGap[] }>(
      `${environment.apiUrl}/recommendations/movie`, { params }
    ).pipe(map(res => res.gaps));
  }

  startScan(
    libraryName: string,
    showExisting: boolean,
    freshScan = false,
    source: string = 'plex'
  ): Observable<{ status: string; total: number }> {
    return this.http.post<{ status: string; total: number }>(
      `${environment.apiUrl}/recommendations/scan`,
      { libraryName, showExisting, freshScan, source }
    );
  }

  getScanProgress(): Observable<ScanProgress> {
    return this.http.get<ScanProgress>(
      `${environment.apiUrl}/recommendations/scan/progress`
    );
  }

  getIgnored(): Observable<number[]> {
    return this.http.get<{ ignored: number[] }>(
      `${environment.apiUrl}/recommendations/ignored`
    ).pipe(map(res => res.ignored));
  }

  addIgnored(tmdbId: number): Observable<any> {
    return this.http.post(`${environment.apiUrl}/recommendations/ignored`, { tmdbId });
  }

  addIgnoredBulk(tmdbIds: number[]): Observable<any> {
    return this.http.post(`${environment.apiUrl}/recommendations/ignored`, { tmdbIds });
  }

  removeIgnored(tmdbId: number): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/recommendations/ignored`, {
      body: { tmdbId }
    });
  }

  removeIgnoredBulk(tmdbIds: number[]): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/recommendations/ignored`, {
      body: { tmdbIds }
    });
  }
}
