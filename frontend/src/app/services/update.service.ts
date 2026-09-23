import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UpdateSelection {
  channel: 'stable' | 'develop' | 'version';
  version: string;
}

export interface BuildInfo {
  version: string;
  commit: string;
  installType?: 'docker' | 'source';
  buildSource?: string;
  channel?: string;
  branch?: string;
  image?: string;
  registry?: string;
}

export interface UpdateStatus {
  build: BuildInfo;
  updater: {
    available: boolean;
    reason: string;
    state?: string;
    message?: string;
    selection?: UpdateSelection;
    currentImage?: string;
    imageId?: string;
    requestId?: string;
  };
}

@Injectable({ providedIn: 'root' })
export class UpdateService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<UpdateStatus> {
    return this.http.get<UpdateStatus>(`${environment.apiUrl}/updates`);
  }

  getReleases(): Observable<{ versions: string[] }> {
    return this.http.get<{ versions: string[] }>(`${environment.apiUrl}/updates/releases`);
  }

  apply(selection: UpdateSelection): Observable<{ requestId: string; message: string }> {
    return this.http.post<{ requestId: string; message: string }>(`${environment.apiUrl}/updates/apply`, selection, {
      headers: { 'X-GAPS-Update': '1' },
    });
  }
}
