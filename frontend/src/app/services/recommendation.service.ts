import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CollectionGap } from '../models/recommendation.model';

@Injectable({
  providedIn: 'root'
})
export class RecommendationService {

  constructor(private http: HttpClient) {}

  getGapsForMovie(
    movieId: number,
    libraryName: string,
    showExisting: boolean
  ): Observable<CollectionGap[]> {
    const params = new HttpParams()
      .set('movieId', movieId.toString())
      .set('libraryName', libraryName)
      .set('showExisting', showExisting.toString());
    return this.http.get<{ gaps: CollectionGap[] }>(
      `${environment.apiUrl}/recommendations/movie`, { params }
    ).pipe(map(res => res.gaps));
  }

  scanLibrary(
    libraryName: string,
    showExisting: boolean
  ): Observable<{ gaps: CollectionGap[], totalOwned: number }> {
    return this.http.post<{ gaps: CollectionGap[], totalOwned: number }>(
      `${environment.apiUrl}/recommendations/scan`,
      { libraryName, showExisting }
    );
  }
}
