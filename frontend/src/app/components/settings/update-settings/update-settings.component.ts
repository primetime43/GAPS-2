import { Component, OnDestroy, OnInit } from '@angular/core';
import { of, Subject, timer } from 'rxjs';
import { catchError, switchMap, takeUntil } from 'rxjs/operators';
import { UpdateSelection, UpdateService, UpdateStatus } from '../../../services/update.service';

const REQUEST_KEY = 'gaps-update-request';
const BUSY = ['queued', 'pulling', 'backing-up', 'restarting', 'checking', 'rolling-back'];

@Component({
  selector: 'app-update-settings',
  templateUrl: './update-settings.component.html',
  standalone: false,
})
export class UpdateSettingsComponent implements OnInit, OnDestroy {
  status: UpdateStatus | null = null;
  choice: UpdateSelection = { channel: 'stable', version: '' };
  versions: string[] = [];
  error = '';
  releasesError = '';
  reconnecting = false;
  submitting = false;
  confirmVisible = false;
  requestId = '';
  private initialized = false;
  private destroy$ = new Subject<void>();

  constructor(private updates: UpdateService) {}

  get busy(): boolean {
    return this.submitting || !!this.requestId || BUSY.includes(this.status?.updater.state || '');
  }

  get canApply(): boolean {
    return !!this.status?.updater.available && !this.busy &&
      (this.choice.channel !== 'version' || /^v?\d+\.\d+\.\d+$/.test(this.choice.version.trim()));
  }

  get targetLabel(): string {
    return this.choice.channel === 'version' ? `version ${this.choice.version}` : this.choice.channel;
  }

  ngOnInit(): void {
    try { this.requestId = localStorage.getItem(REQUEST_KEY) || ''; } catch { /* storage can be disabled */ }
    this.updates.getReleases().pipe(takeUntil(this.destroy$)).subscribe({
      next: result => this.versions = result.versions,
      error: () => this.releasesError = 'Could not load releases. You can enter a version below.',
    });
    timer(0, 3000).pipe(
      switchMap(() => this.updates.getStatus().pipe(catchError(() => of(null)))),
      takeUntil(this.destroy$),
    ).subscribe(status => {
      this.reconnecting = !status;
      if (!status) return;
      this.status = status;
      if (!this.initialized) {
        this.choice = status.updater.selection ? { ...status.updater.selection } : {
          channel: status.build.channel === 'develop' ? 'develop' : 'stable', version: '',
        };
        this.initialized = true;
      }
      if (this.requestId && status.updater.requestId === this.requestId &&
          ['done', 'error'].includes(status.updater.state || '')) {
        this.requestId = '';
        try { localStorage.removeItem(REQUEST_KEY); } catch { /* storage can be disabled */ }
        if (status.updater.state === 'done') this.reloadPage();
      }
    });
  }

  apply(): void {
    this.confirmVisible = false;
    if (!this.canApply) return;
    this.submitting = true;
    this.error = '';
    this.updates.apply({ ...this.choice, version: this.choice.version.trim() }).pipe(takeUntil(this.destroy$)).subscribe({
      next: result => {
        this.requestId = result.requestId;
        this.submitting = false;
        try { localStorage.setItem(REQUEST_KEY, this.requestId); } catch { /* storage can be disabled */ }
      },
      error: error => {
        this.error = error.error?.error || 'Could not request the update.';
        this.submitting = false;
      },
    });
  }

  reloadPage(): void {
    window.location.reload();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
