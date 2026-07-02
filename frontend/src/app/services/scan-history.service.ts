import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScanHistoryGap {
  // movie entries carry tmdbId + collectionName; tv entries carry tvdbId + franchiseName.
  tmdbId?: number;
  tvdbId?: number;
  name: string;
  year: string | number;
  collectionName?: string;
  franchiseName?: string;
  owned: boolean;
}

export interface ScanHistoryEntry {
  id?: string;
  timestamp: string;
  mediaType: 'movie' | 'tv';
  libraries: string[];
  totalOwned: number;
  missing: number;
  status: 'success' | 'skipped' | 'error';
  trigger: 'manual' | 'scheduled';
  message: string;
  hasGaps?: boolean;
}

export interface ScanHistoryEntryDetail extends ScanHistoryEntry {
  gaps: ScanHistoryGap[];
}

export interface ScanHistoryResponse {
  history: ScanHistoryEntry[];
  lastMovie: ScanHistoryEntry | null;
  lastTv: ScanHistoryEntry | null;
}

// A saved scan's gaps rehydrated (posters/ratings pulled from cache) in the same
// shape a live scan returns, so the Missing view can reopen it like a fresh scan.
export interface ScanHistoryGapsResponse {
  gaps: any[];
  mediaType: 'movie' | 'tv';
  libraries: string[];
  totalOwned: number;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class ScanHistoryService {
  private readonly base = `${environment.apiUrl}/scan-history`;

  constructor(private http: HttpClient) {}

  get(mediaType?: 'movie' | 'tv', limit?: number): Observable<ScanHistoryResponse> {
    const params: Record<string, string> = {};
    if (mediaType) params['mediaType'] = mediaType;
    if (limit) params['limit'] = String(limit);
    return this.http.get<ScanHistoryResponse>(this.base, { params });
  }

  getById(id: string): Observable<ScanHistoryEntryDetail> {
    return this.http.get<ScanHistoryEntryDetail>(`${this.base}/${encodeURIComponent(id)}`);
  }

  /** Fetch a saved scan's gaps rehydrated from cache, for reopening in the Missing view. */
  getGaps(id: string): Observable<ScanHistoryGapsResponse> {
    return this.http.get<ScanHistoryGapsResponse>(`${this.base}/${encodeURIComponent(id)}/gaps`);
  }
}
