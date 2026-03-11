import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface UserPreferences {
  defaultLibrary: string;
  moviesPerPage: number;
  hideOwnedByDefault: boolean;
  language: string;
  port: number;
  autoOpenBrowser: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PreferencesService {
  private prefsSubject = new BehaviorSubject<UserPreferences | null>(null);
  prefs$ = this.prefsSubject.asObservable();

  constructor(private http: HttpClient) {}

  load(): Observable<UserPreferences> {
    return this.http.get<UserPreferences>(`${environment.apiUrl}/preferences`).pipe(
      tap(prefs => this.prefsSubject.next(prefs))
    );
  }

  save(prefs: Partial<UserPreferences>): Observable<UserPreferences> {
    return this.http.post<UserPreferences>(`${environment.apiUrl}/preferences`, prefs).pipe(
      tap(saved => this.prefsSubject.next(saved))
    );
  }

  get current(): UserPreferences | null {
    return this.prefsSubject.value;
  }
}
