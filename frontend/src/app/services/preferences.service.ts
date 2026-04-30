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
}

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
