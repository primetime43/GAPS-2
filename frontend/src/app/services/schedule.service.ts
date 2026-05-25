import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScheduleLastRun {
  timestamp: string;
  status: 'success' | 'skipped' | 'error';
  library: string;
  missing: number;
  collections: number;
  message: string;
  mediaType?: 'movie' | 'tv';
}

export interface ScheduleBlock {
  enabled: boolean;
  preset: string;
  library: string;
  next_run: string | null;
}

export interface ScheduleConfig {
  source: string;
  movie: ScheduleBlock;
  tv: ScheduleBlock;
  last_run: ScheduleLastRun | null;
  run_history: ScheduleLastRun[];
  presets: { [key: string]: string };
  // Convenience fields summarising both schedules (used by the dashboard).
  enabled: boolean;
  preset: string;
  next_run: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {

  constructor(private http: HttpClient) {}

  getSchedule(): Observable<ScheduleConfig> {
    return this.http.get<ScheduleConfig>(`${environment.apiUrl}/schedule`);
  }

  setSchedule(
    mediaType: 'movie' | 'tv', preset: string, library: string, source: string,
  ): Observable<ScheduleConfig> {
    return this.http.post<ScheduleConfig>(
      `${environment.apiUrl}/schedule`,
      { mediaType, preset, library, source },
    );
  }

  disableSchedule(mediaType: 'movie' | 'tv'): Observable<ScheduleConfig> {
    return this.http.delete<ScheduleConfig>(`${environment.apiUrl}/schedule?mediaType=${mediaType}`);
  }
}
