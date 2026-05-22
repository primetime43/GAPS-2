import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiMessage } from '../models/api-response.model';

export interface SonarrConfig {
  enabled: boolean;
  url: string;
  api_key: string;
  quality_profile_id: number;
  root_folder_path: string;
  monitored: boolean;
  season_folder: boolean;
  search_on_add: boolean;
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
}

export interface SonarrRootFolder {
  path: string;
  free_space: number;
  accessible: boolean;
}

@Injectable({ providedIn: 'root' })
export class SonarrService {
  constructor(private http: HttpClient) {}

  getConfig(): Observable<SonarrConfig> {
    return this.http.get<SonarrConfig>(`${environment.apiUrl}/sonarr/config`);
  }

  saveConfig(config: Partial<SonarrConfig>): Observable<SonarrConfig> {
    return this.http.post<SonarrConfig>(`${environment.apiUrl}/sonarr/config`, config);
  }

  clearConfig(): Observable<ApiMessage> {
    return this.http.delete<ApiMessage>(`${environment.apiUrl}/sonarr/config`);
  }

  testConnection(url: string, apiKey: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/sonarr/test`, { url, api_key: apiKey });
  }

  getProfiles(): Observable<SonarrQualityProfile[]> {
    return this.http.get<SonarrQualityProfile[]>(`${environment.apiUrl}/sonarr/profiles`);
  }

  getRootFolders(): Observable<SonarrRootFolder[]> {
    return this.http.get<SonarrRootFolder[]>(`${environment.apiUrl}/sonarr/root-folders`);
  }

  getLibraryTvdbIds(): Observable<{ tvdb_ids: number[] }> {
    return this.http.get<{ tvdb_ids: number[] }>(`${environment.apiUrl}/sonarr/series`);
  }

  addSeries(tvdbId: number, title: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/sonarr/add`, {
      tvdb_id: tvdbId,
      title,
    });
  }
}
