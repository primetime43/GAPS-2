import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PlexAuthResponse, PlexServersResponse, ActiveServerResponse, PlexLibrary, PlexConnection } from '../models/plex.model';
import { ApiResult } from '../models/api-response.model';

@Injectable({
  providedIn: 'root'
})
export class PlexService {

  constructor(private http: HttpClient) {}

  connectManual(serverUrl: string, token: string): Observable<{ connected: boolean; serverName: string; libraries: PlexLibrary[]; error?: string }> {
    return this.http.post<{ connected: boolean; serverName: string; libraries: PlexLibrary[]; error?: string }>(
      `${environment.apiUrl}/plex/connect-manual`, { serverUrl, token }
    );
  }

  authenticate(): Observable<PlexAuthResponse> {
    return this.http.post<PlexAuthResponse>(`${environment.apiUrl}/plex/authenticate`, {});
  }

  checkLogin(): Observable<{ authenticated: boolean }> {
    return this.http.get<{ authenticated: boolean }>(`${environment.apiUrl}/plex/check-login`);
  }

  fetchServers(): Observable<PlexServersResponse> {
    return this.http.post<PlexServersResponse>(`${environment.apiUrl}/plex/fetch-servers`, {});
  }

  fetchLibraries(serverName: string, connectionUrl?: string): Observable<{ libraries: PlexLibrary[], token: string, connections: PlexConnection[] }> {
    let url = `${environment.apiUrl}/plex/libraries/${encodeURIComponent(serverName)}`;
    if (connectionUrl) {
      url += `?connectionUrl=${encodeURIComponent(connectionUrl)}`;
    }
    return this.http.get<{ libraries: PlexLibrary[], token: string, connections: PlexConnection[] }>(url);
  }

  saveData(server: string, token: string, libraries: PlexLibrary[], serverUrl?: string): Observable<ApiResult> {
    return this.http.post<ApiResult>(`${environment.apiUrl}/plex/save-data`, {
      server,
      token,
      libraries,
      ...(serverUrl ? { serverUrl } : {})
    });
  }

  getActiveServer(): Observable<ActiveServerResponse> {
    return this.http.get<ActiveServerResponse>(`${environment.apiUrl}/plex/active-server`);
  }

  removeServer(): Observable<ApiResult> {
    return this.http.delete<ApiResult>(`${environment.apiUrl}/plex/active-server`);
  }

  testConnection(): Observable<{ connected: boolean; serverName?: string; error?: string }> {
    return this.http.post<{ connected: boolean; serverName?: string; error?: string }>(
      `${environment.apiUrl}/plex/test-active`, {}
    );
  }

  refreshConnection(): Observable<{ connected: boolean; libraries?: any[]; error?: string }> {
    return this.http.post<{ connected: boolean; libraries?: any[]; error?: string }>(
      `${environment.apiUrl}/plex/refresh`, {}
    );
  }
}
