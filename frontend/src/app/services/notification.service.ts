import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface NotificationConfig {
  discord: { enabled: boolean; webhook_url: string };
  telegram: { enabled: boolean; bot_token: string; chat_id: string };
  email: {
    enabled: boolean; smtp_host: string; smtp_port: number;
    username: string; password: string; from_addr: string; to_addr: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {

  constructor(private http: HttpClient) {}

  getConfig(): Observable<NotificationConfig> {
    return this.http.get<NotificationConfig>(`${environment.apiUrl}/notifications`);
  }

  saveConfig(service: string, config: any): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/notifications/${service}`, config);
  }

  testNotification(service: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${environment.apiUrl}/notifications/${service}/test`, {});
  }
}
