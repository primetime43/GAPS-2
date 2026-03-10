import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Recommendation } from '../models/recommendation.model';

@Injectable({
  providedIn: 'root'
})
export class RecommendationService {

  constructor(private http: HttpClient) {}

  getRecommendations(
    movieId: number,
    apiKey: string,
    libraryName: string,
    showExisting: boolean
  ): Observable<Recommendation[]> {
    const params = new HttpParams()
      .set('movieId', movieId.toString())
      .set('apiKey', apiKey)
      .set('libraryName', libraryName)
      .set('showExisting', showExisting.toString());
    return this.http.get<Recommendation[]>(`${environment.apiUrl}/recommendations`, { params });
  }

  getCachedRecommendations(): Observable<Recommendation[]> {
    return this.http.get<Recommendation[]>(`${environment.apiUrl}/recommendations/cached`);
  }
}
