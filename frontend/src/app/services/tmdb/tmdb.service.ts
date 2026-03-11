import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiMessage } from '../../models/api-response.model';

export interface TmdbStatus {
  hasKey: boolean;
  apiKey: string;
}

@Injectable({
  providedIn: 'root'
})
export class TmdbService {

  constructor(private http: HttpClient) {}

  getStatus(): Observable<TmdbStatus> {
    return this.http.get<TmdbStatus>(`${environment.apiUrl}/tmdb/status`);
  }

  testApiKey(key: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/tmdb/test-key`, { api_key: key });
  }

  saveApiKey(key: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/tmdb/save-key`, { key });
  }
}
