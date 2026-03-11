import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiMessage } from '../../models/api-response.model';

@Injectable({
  providedIn: 'root'
})
export class TmdbService {
  private readonly STORAGE_KEY = 'gaps2_tmdb_api_key';

  constructor(private http: HttpClient) {}

  testApiKey(key: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/tmdb/test-key`, { api_key: key });
  }

  saveApiKey(key: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/tmdb/save-key`, { key });
  }

  getApiKey(): string {
    return localStorage.getItem(this.STORAGE_KEY) || '';
  }

  setApiKey(key: string): void {
    localStorage.setItem(this.STORAGE_KEY, key);
  }

  hasApiKey(): boolean {
    return !!this.getApiKey();
  }
}
