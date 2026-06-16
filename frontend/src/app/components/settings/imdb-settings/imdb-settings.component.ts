import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { ImdbService, ImdbStatus } from '../../../services/imdb.service';

/**
 * IMDb support settings, backed by IMDb's free official ratings dataset
 * (datasets.imdbws.com): the integration toggle (enable + dataset URL +
 * download status) that powers IMDb ratings on movie cards. The TMDB/IMDb link
 * provider lives under User Preferences and the results-page Filters menus.
 */
@Component({
    selector: 'app-imdb-settings',
    templateUrl: './imdb-settings.component.html',
    styleUrls: ['./imdb-settings.component.scss'],
    standalone: false
})
export class ImdbSettingsComponent implements OnInit, OnDestroy {
  status: ImdbStatus = {
    enabled: false, datasetUrl: '', ready: false,
    titleCount: 0, updatedAt: null, building: false, error: null,
  };

  loading = true;
  saving = false;
  saved = false;

  message = '';
  messageType: 'success' | 'error' | '' = '';

  private destroy$ = new Subject<void>();
  private pollTimer: any = null;

  constructor(private imdbService: ImdbService) {}

  ngOnInit(): void {
    this.imdbService.getStatus().pipe(
      catchError(() => of(null)), takeUntil(this.destroy$)
    ).subscribe((status) => {
      if (status) this.status = status;
      this.loading = false;
      if (this.status.building) this.pollStatus();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  get datasetLabel(): string {
    if (this.status.building) return 'Downloading…';
    if (!this.status.ready) return 'Not downloaded yet';
    const count = this.status.titleCount.toLocaleString();
    return `${count} titles${this.status.updatedAt ? ' · updated ' + this.status.updatedAt : ''}`;
  }

  refresh(): void {
    this.clearMessage();
    this.imdbService.refresh().pipe(catchError(() => of(null))).subscribe((status) => {
      if (status) this.status = status;
      this.pollStatus();
    });
  }

  /** Poll status while a download is in progress so the UI updates live. */
  private pollStatus(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      this.imdbService.getStatus().pipe(catchError(() => of(null))).subscribe((status) => {
        if (status) this.status = status;
        if (status?.building) {
          this.pollStatus();
        } else if (status?.error) {
          this.showMessage(`Download failed: ${status.error}`, 'error');
        } else if (status?.ready) {
          this.showMessage('Ratings dataset is ready.', 'success');
        }
      });
    }, 2000);
  }

  save(): void {
    this.saving = true;
    this.saved = false;
    this.clearMessage();
    this.imdbService.saveConfig({ enabled: this.status.enabled, datasetUrl: this.status.datasetUrl }).subscribe({
      next: () => {
        this.saving = false;
        this.saved = true;
        setTimeout(() => this.saved = false, 3000);
        // Enabling kicks off a download server-side; reflect that in the UI.
        this.imdbService.getStatus().pipe(catchError(() => of(null))).subscribe((status) => {
          if (status) this.status = status;
          if (this.status.building) this.pollStatus();
        });
      },
      error: () => {
        this.showMessage('Failed to save settings.', 'error');
        this.saving = false;
      },
    });
  }

  private showMessage(msg: string, type: 'success' | 'error'): void {
    this.message = msg;
    this.messageType = type;
  }

  private clearMessage(): void {
    this.message = '';
    this.messageType = '';
  }
}
