import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ApiMessage } from '../models/api-response.model';

export interface TvdbConfig {
  enabled: boolean;
  api_key: string;
  pin: string;
  language: string;
}

export interface TvdbGap {
  tvdbId: number;
  name: string;
  year: string | number;
  posterUrl: string | null;
  overview: string;
  slug: string | null;
  franchiseName: string;
  owned: boolean;
}

export interface TvdbScanProgress {
  status: 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';
  processed: number;
  total: number;
  current_show: string;
  franchises_found: number;
  gaps: TvdbGap[];
  total_owned: number;
  libraries: string[];
  completed_at: string | null;
  error: string | null;
}

export interface TvdbScanRequest {
  source?: string;
  libraryName?: string;
  libraryNames?: string[];
  showExisting?: boolean;
  freshScan?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TvdbService {
  constructor(private http: HttpClient) {}

  getConfig(): Observable<TvdbConfig> {
    return this.http.get<TvdbConfig>(`${environment.apiUrl}/tvdb/config`);
  }

  saveConfig(config: Partial<TvdbConfig>): Observable<TvdbConfig> {
    return this.http.post<TvdbConfig>(`${environment.apiUrl}/tvdb/config`, config);
  }

  clearConfig(): Observable<ApiMessage> {
    return this.http.delete<ApiMessage>(`${environment.apiUrl}/tvdb/config`);
  }

  testConnection(apiKey: string, pin: string): Observable<ApiMessage> {
    return this.http.post<ApiMessage>(`${environment.apiUrl}/tvdb/test`, { api_key: apiKey, pin });
  }

  startScan(req: TvdbScanRequest): Observable<{ status: string; total_owned: number }> {
    return this.http.post<{ status: string; total_owned: number }>(
      `${environment.apiUrl}/tvdb/scan`,
      req,
    );
  }

  getGapsForShow(
    tvdbId: number,
    libraryNames: string[],
    showExisting: boolean,
    source: string = 'plex',
  ): Observable<TvdbGap[]> {
    let params = new HttpParams()
      .set('tvdbId', tvdbId.toString())
      .set('showExisting', showExisting.toString())
      .set('source', source);
    for (const lib of libraryNames) {
      params = params.append('libraryNames', lib);
    }
    return this.http
      .get<{ gaps: TvdbGap[] }>(`${environment.apiUrl}/tvdb/show`, { params })
      .pipe(map((res) => res.gaps));
  }

  getScanProgress(): Observable<TvdbScanProgress> {
    return this.http.get<TvdbScanProgress>(`${environment.apiUrl}/tvdb/scan/progress`);
  }

  cancelScan(): Observable<{ cancelled: boolean }> {
    return this.http.post<{ cancelled: boolean }>(`${environment.apiUrl}/tvdb/scan/cancel`, {});
  }

  getIgnored(): Observable<number[]> {
    return this.http
      .get<{ ignored: number[] }>(`${environment.apiUrl}/tvdb/ignored`)
      .pipe(map((res) => res.ignored));
  }

  addIgnored(tvdbId: number): Observable<any> {
    return this.http.post(`${environment.apiUrl}/tvdb/ignored`, { tvdbId });
  }

  addIgnoredBulk(tvdbIds: number[]): Observable<any> {
    return this.http.post(`${environment.apiUrl}/tvdb/ignored`, { tvdbIds });
  }

  removeIgnored(tvdbId: number): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/tvdb/ignored`, { body: { tvdbId } });
  }

  removeIgnoredBulk(tvdbIds: number[]): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/tvdb/ignored`, { body: { tvdbIds } });
  }
}
