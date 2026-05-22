import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiMessage } from '../models/api-response.model';

export interface RadarrConfig {
  enabled: boolean;
  url: string;
  api_key: string;
  quality_profile_id: number;
  root_folder_path: string;
  minimum_availability: string;
  monitored: boolean;
  search_on_add: boolean;
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
}

export interface RadarrRootFolder {
  path: string;
  free_space: number;
  accessible: boolean;
}

@Injectable({ providedIn: 'root' })
export class RadarrService {
  constructor(private http: HttpClient) {}

  getConfig(): Observable<RadarrConfig> {
    return this.http.get<RadarrConfig>(`${environment.apiUrl}/radarr/config`);
  }

  saveConfig(config: Partial<RadarrConfig>): Observable<RadarrConfig> {
    return this.http.post<RadarrConfig>(`${environment.apiUrl}/radarr/config`, config);
  }

  clearConfig(): Observable<ApiMessage> {
    return this.http.delete<ApiMessage>(`${environment.apiUrl}/radarr/config`);
  }

  testConnection(url: string, apiKey: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/radarr/test`, { url, api_key: apiKey });
  }

  getProfiles(): Observable<RadarrQualityProfile[]> {
    return this.http.get<RadarrQualityProfile[]>(`${environment.apiUrl}/radarr/profiles`);
  }

  getRootFolders(): Observable<RadarrRootFolder[]> {
    return this.http.get<RadarrRootFolder[]>(`${environment.apiUrl}/radarr/root-folders`);
  }

  getLibraryTmdbIds(): Observable<{ tmdb_ids: number[] }> {
    return this.http.get<{ tmdb_ids: number[] }>(`${environment.apiUrl}/radarr/movies`);
  }

  addMovie(tmdbId: number, title: string, year: number): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/radarr/add`, {
      tmdb_id: tmdbId,
      title,
      year,
    });
  }
}
