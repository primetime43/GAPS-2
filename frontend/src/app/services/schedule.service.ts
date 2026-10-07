import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScheduleLastRun {
  timestamp: string;
  status: 'success' | 'skipped' | 'error';
  library: string;
  libraries?: string[];
  source?: string;
  server?: string;
  missing: number;
  collections: number;
  message: string;
  mediaType?: 'movie' | 'tv';
}

export interface ScheduleBlock {
  enabled: boolean;
  preset: string;
  libraries: string[];
  library: string;       // joined label (back-compat / display)
  hour: number;
  minute: number;
  dayOfWeek: string;
  description: string;   // human-readable, e.g. "Weekly on Wednesday at 6:00 AM"
  next_run: string | null;
}

export interface ScheduleConfig {
  source: string;
  movie: ScheduleBlock;
  tv: ScheduleBlock;
  last_run: ScheduleLastRun | null;
  run_history: ScheduleLastRun[];
  historyLimit?: number;
  presets: { [key: string]: string };  // frequency key → label (Hourly, Daily, …)
  days: { [key: string]: string };     // day-of-week key → label (mon → Monday)
  // Legacy convenience fields summarising both schedules.
  enabled: boolean;
  preset: string;
  description: string;
  next_run: string | null;
}

export interface SetScheduleRequest {
  mediaType: 'movie' | 'tv';
  preset: string;
  libraries: string[];
  source: string;
  hour: number;
  minute: number;
  dayOfWeek: string;
}

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {

  constructor(private http: HttpClient) {}

  getSchedule(): Observable<ScheduleConfig> {
    return this.http.get<ScheduleConfig>(`${environment.apiUrl}/schedule`);
  }

  setSchedule(req: SetScheduleRequest): Observable<ScheduleConfig> {
    return this.http.post<ScheduleConfig>(`${environment.apiUrl}/schedule`, req);
  }

  setHistoryLimit(historyLimit: number): Observable<{ historyLimit: number; run_history: ScheduleLastRun[] }> {
    return this.http.put<{ historyLimit: number; run_history: ScheduleLastRun[] }>(
      `${environment.apiUrl}/schedule/history`, { historyLimit },
    );
  }

  disableSchedule(mediaType: 'movie' | 'tv'): Observable<ScheduleConfig> {
    return this.http.delete<ScheduleConfig>(`${environment.apiUrl}/schedule?mediaType=${mediaType}`);
  }
}
