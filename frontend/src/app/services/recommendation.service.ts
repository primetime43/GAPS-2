import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CollectionGap } from '../models/recommendation.model';
import { Movie } from '../models/movie.model';

@Injectable({
  providedIn: 'root'
})
export class RecommendationService {

  constructor(private http: HttpClient) {}

  getGapsForMovie(
    movie: Movie,
    libraryName: string,
    showExisting: boolean
  ): Observable<CollectionGap[]> {
    let params = new HttpParams()
      .set('libraryName', libraryName)
      .set('showExisting', showExisting.toString());

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

  scanLibrary(
    libraryName: string,
    showExisting: boolean,
    freshScan = false
  ): Observable<{ gaps: CollectionGap[], totalOwned: number }> {
    return this.http.post<{ gaps: CollectionGap[], totalOwned: number }>(
      `${environment.apiUrl}/recommendations/scan`,
      { libraryName, showExisting, freshScan }
    );
  }
}
