import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { PlexAuthResponse, PlexServersResponse, ActiveServerResponse } from '../models/plex.model';
import { ApiResult } from '../models/api-response.model';

@Injectable({
  providedIn: 'root'
})
export class PlexService {

  constructor(private http: HttpClient) {}

  authenticate(): Observable<PlexAuthResponse> {
    return this.http.post<PlexAuthResponse>(`${environment.apiUrl}/plex/authenticate`, {});
  }

  fetchServers(): Observable<PlexServersResponse> {
    return this.http.post<PlexServersResponse>(`${environment.apiUrl}/plex/fetch-servers`, {});
  }

  fetchLibraries(serverName: string): Observable<{ libraries: string[], token: string }> {
    return this.http.get<{ libraries: string[], token: string }>(
      `${environment.apiUrl}/plex/libraries/${encodeURIComponent(serverName)}`
    );
  }

  saveData(server: string, token: string, libraries: string[] | Record<string, string[]>): Observable<ApiResult> {
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
