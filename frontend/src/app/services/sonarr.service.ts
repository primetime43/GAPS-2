import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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
  tags: number[];
  library_root_folders: SonarrLibraryMapping[];
}

export interface SonarrTag {
  id: number;
  label: string;
}

export interface SonarrLibrary {
  source: string;
  server: string;
  library: string;
}

export interface SonarrLibraryMapping extends SonarrLibrary {
  root_folder_path: string;
}

export interface SonarrAddContext {
  source: string;
  server: string;
  library_names: string[];
  root_folder_path?: string;
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

  getConfig(reveal: boolean = false): Observable<SonarrConfig> {
    const params = reveal ? new HttpParams().set('reveal', 'true') : undefined;
    return this.http.get<SonarrConfig>(`${environment.apiUrl}/sonarr/config`, { params });
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

  getTags(): Observable<SonarrTag[]> {
    return this.http.get<SonarrTag[]>(`${environment.apiUrl}/sonarr/tags`);
  }

  getLibraries(): Observable<SonarrLibrary[]> {
    return this.http.get<SonarrLibrary[]>(`${environment.apiUrl}/sonarr/libraries`);
  }

  addSeries(tvdbId: number, title: string, context?: SonarrAddContext): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/sonarr/add`, {
      tvdb_id: tvdbId,
      title,
      ...context,
    });
  }
}
