import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScheduleConfig {
  enabled: boolean;
  preset: string;
  library: string;
  next_run: string | null;
  presets: { [key: string]: string };
}

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {

  constructor(private http: HttpClient) {}

  getSchedule(): Observable<ScheduleConfig> {
    return this.http.get<ScheduleConfig>(`${environment.apiUrl}/schedule`);
  }

  setSchedule(preset: string, library: string): Observable<ScheduleConfig> {
    return this.http.post<ScheduleConfig>(`${environment.apiUrl}/schedule`, { preset, library });
  }

  disableSchedule(): Observable<ScheduleConfig> {
    return this.http.delete<ScheduleConfig>(`${environment.apiUrl}/schedule`);
  }
}
