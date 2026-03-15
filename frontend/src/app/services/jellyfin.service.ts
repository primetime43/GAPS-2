import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ActiveServerResponse } from '../models/plex.model';
import { ApiResult } from '../models/api-response.model';

export interface JellyfinConnectResponse {
  connected: boolean;
  serverName: string;
  libraries: { title: string; type: string; id: string }[];
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class JellyfinService {

  constructor(private http: HttpClient) {}

  connect(serverUrl: string, apiKey: string): Observable<JellyfinConnectResponse> {
    return this.http.post<JellyfinConnectResponse>(`${environment.apiUrl}/jellyfin/connect`, {
      serverUrl, apiKey
    });
  }

  save(serverUrl: string, apiKey: string, serverName: string, libraries: any[]): Observable<ApiResult> {
    return this.http.post<ApiResult>(`${environment.apiUrl}/jellyfin/save`, {
      serverUrl, apiKey, serverName, libraries
    });
  }

  getActiveServer(): Observable<ActiveServerResponse> {
    return this.http.get<ActiveServerResponse>(`${environment.apiUrl}/jellyfin/active-server`);
  }

  removeServer(): Observable<ApiResult> {
    return this.http.delete<ApiResult>(`${environment.apiUrl}/jellyfin/active-server`);
  }

  testConnection(): Observable<{ connected: boolean; serverName?: string; error?: string }> {
    return this.http.post<{ connected: boolean; serverName?: string; error?: string }>(
      `${environment.apiUrl}/jellyfin/test-active`, {}
    );
  }

  refreshConnection(): Observable<{ connected: boolean; libraries?: any[]; error?: string }> {
    return this.http.post<{ connected: boolean; libraries?: any[]; error?: string }>(
      `${environment.apiUrl}/jellyfin/refresh`, {}
    );
  }
}
