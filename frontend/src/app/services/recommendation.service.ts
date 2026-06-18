import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CollectionGap } from '../models/recommendation.model';
import { Movie } from '../models/movie.model';

export interface ScanProgress {
  status: 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';
  processed: number;
  total: number;
  current_movie: string;
  collections_found: number;
  gaps: CollectionGap[];
  total_owned: number;
  libraries: string[];
  completed_at: string | null;
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
    source: string = 'plex',
    additionalLibraries: string[] = []
  ): Observable<CollectionGap[]> {
    let params = new HttpParams()
      .set('showExisting', showExisting.toString())
      .set('source', source);

    // Send all libraries to check ownership across
    const allLibs = [libraryName, ...additionalLibraries.filter(l => l !== libraryName)];
    for (const lib of allLibs) {
      params = params.append('libraryNames', lib);
    }

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
    libraryNames: string[],
    showExisting: boolean,
    freshScan = false,
    source: string = 'plex',
    incremental = false
  ): Observable<{ status: string; total: number; mode: 'full' | 'incremental' }> {
    return this.http.post<{ status: string; total: number; mode: 'full' | 'incremental' }>(
      `${environment.apiUrl}/recommendations/scan`,
      { libraryNames, showExisting, freshScan, source, incremental }
    );
  }

  getScanProgress(): Observable<ScanProgress> {
    return this.http.get<ScanProgress>(
      `${environment.apiUrl}/recommendations/scan/progress`
    );
  }

  cancelScan(): Observable<{ cancelled: boolean }> {
    return this.http.post<{ cancelled: boolean }>(
      `${environment.apiUrl}/recommendations/scan/cancel`, {}
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
