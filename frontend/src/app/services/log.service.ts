import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
}

@Injectable({
  providedIn: 'root'
})
export class LogService {

  constructor(private http: HttpClient) {}

  getLogs(level?: string): Observable<{ entries: LogEntry[] }> {
    const params: any = {};
    if (level) {
      params.level = level;
    }
    return this.http.get<{ entries: LogEntry[] }>(`${environment.apiUrl}/logs`, { params });
  }

  clearLogs(): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/logs`);
  }
}
