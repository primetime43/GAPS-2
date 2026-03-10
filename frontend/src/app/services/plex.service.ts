import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PlexAuthResponse, PlexServersResponse, ActiveServerResponse, PlexLibrary } from '../models/plex.model';
import { ApiResult } from '../models/api-response.model';

@Injectable({
  providedIn: 'root'
})
export class PlexService {

  constructor(private http: HttpClient) {}

  authenticate(): Observable<PlexAuthResponse> {
    return this.http.post<PlexAuthResponse>(`${environment.apiUrl}/plex/authenticate`, {});
  }

  checkLogin(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>(`${environment.apiUrl}/plex/check-login`);
  }

  fetchServers(): Observable<PlexServersResponse> {
    return this.http.post<PlexServersResponse>(`${environment.apiUrl}/plex/fetch-servers`, {});
  }

  fetchLibraries(serverName: string): Observable<{ libraries: PlexLibrary[], token: string }> {
    return this.http.get<{ libraries: PlexLibrary[], token: string }>(
      `${environment.apiUrl}/plex/libraries/${encodeURIComponent(serverName)}`
    );
  }

  saveData(server: string, token: string, libraries: PlexLibrary[]): Observable<ApiResult> {
    return this.http.post<ApiResult>(`${environment.apiUrl}/plex/save-data`, {
      server,
      token,
      libraries
    });
  }

  getActiveServer(): Observable<ActiveServerResponse> {
    return this.http.get<ActiveServerResponse>(`${environment.apiUrl}/plex/active-server`);
  }
}
