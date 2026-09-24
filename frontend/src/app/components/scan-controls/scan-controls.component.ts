import { CommonModule } from '@angular/common';
import { Component, DestroyRef, EventEmitter, OnInit, Output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { forkJoin, interval, merge, Observable, of, Subject } from 'rxjs';
import { catchError, exhaustMap, filter, finalize, map, timeout } from 'rxjs/operators';
import { ActiveServer, ActiveServerService } from '../../services/active-server.service';
import { PreferencesService } from '../../services/preferences.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TvdbService } from '../../services/tvdb.service';
import { ScanStatus } from '../../models/scan-status.model';

type MediaType = 'movie' | 'tv';
interface ScanState {
  type: MediaType;
  label: string;
  progress: ScanStatus | null;
  starting: boolean;
  cancelling: boolean;
  visible: boolean;
  error: string;
  pollError: string;
  revision: number;
  refresh: Subject<void>;
}

@Component({
  selector: 'app-scan-controls',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './scan-controls.component.html',
  styleUrls: ['./scan-controls.component.scss'],
})
export class ScanControlsComponent implements OnInit {
  @Output() scanFinished = new EventEmitter<void>();
  scans: ScanState[] = [this.scanState('movie', 'Movies'), this.scanState('tv', 'TV Shows')];
  picker: ScanState | null = null;
  loadingLibraries = false;
  libraryError = '';
  active: ActiveServer | null = null;
  libraries: string[] = [];
  selected: string[] = [];

  constructor(
    private movies: RecommendationService,
    private tv: TvdbService,
    private servers: ActiveServerService,
    private preferences: PreferencesService,
    private destroyRef: DestroyRef,
  ) {}

  private scanState(type: MediaType, label: string): ScanState {
    return { type, label, progress: null, starting: false, cancelling: false, visible: false, error: '', pollError: '', revision: 0, refresh: new Subject<void>() };
  }

  ngOnInit(): void {
    for (const scan of this.scans) {
      merge(of(null), interval(2500), scan.refresh).pipe(
        filter(() => !scan.starting),
        exhaustMap(() => {
          const revision = scan.revision;
          return this.service(scan).getScanStatus().pipe(
            timeout(15000),
            catchError(() => {
              if (revision === scan.revision) scan.pollError = 'Cannot check scan progress. Retrying… The scan may still be running.';
              return of(null);
            }),
            map(progress => ({ progress, revision })),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe(({ progress, revision }) => {
        if (!progress || scan.starting || revision !== scan.revision) return;
        const wasRunning = scan.progress?.status === 'scanning';
        scan.pollError = '';
        scan.progress = progress;
        if (progress.status === 'scanning') scan.visible = true;
        else {
          scan.cancelling = false;
          if (wasRunning) this.scanFinished.emit();
        }
      });
    }
  }

  private service(scan: ScanState): RecommendationService | TvdbService {
    return scan.type === 'movie' ? this.movies : this.tv;
  }

  busy(scan: ScanState): boolean {
    return scan.starting || scan.cancelling || scan.progress?.status === 'scanning';
  }

  canChoose(scan: ScanState): boolean {
    return !!scan.progress && !scan.pollError && !this.busy(scan) && !this.loadingLibraries
      && !this.scans.some(item => item.starting);
  }

  chooseLibraries(scan: ScanState): void {
    if (!this.canChoose(scan)) return;
    this.picker = scan;
    this.active = null;
    this.libraries = [];
    this.selected = [];
    this.libraryError = '';
    this.loadingLibraries = true;
    scan.error = '';
    forkJoin({
      active: this.servers.getActive(),
      prefs: this.preferences.load().pipe(catchError(() => of(null))),
    }).pipe(
      timeout(30000),
      finalize(() => this.loadingLibraries = false),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: ({ active, prefs }) => {
        this.active = active;
        const types = scan.type === 'movie' ? ['movie', 'movies'] : ['show', 'tvshows'];
        this.libraries = [...new Set(active?.libraries.filter(lib => types.includes(lib.type)).map(lib => lib.title) || [])];
        if (!active) this.libraryError = 'Connect a media server in Settings before scanning.';
        else if (!this.libraries.length) this.libraryError = `No ${scan.label.toLowerCase()} libraries are available on ${active.server}.`;
        if (prefs?.defaultLibrary && this.libraries.includes(prefs.defaultLibrary)) this.selected = [prefs.defaultLibrary];
        else if (this.libraries.length === 1) this.selected = [...this.libraries];
      },
      error: () => this.libraryError = 'Could not load libraries. Close this picker and try again.',
    });
  }

  toggleLibrary(library: string): void {
    this.selected = this.selected.includes(library)
      ? this.selected.filter(value => value !== library) : [...this.selected, library];
  }

  startScan(): void {
    const scan = this.picker;
    if (!scan || !this.active || !this.selected.length || !this.canChoose(scan)) return;
    const libraries = this.selected.filter(library => this.libraries.includes(library));
    if (!libraries.length) return;
    scan.starting = true;
    scan.revision++;
    scan.visible = true;
    scan.error = '';
    const start$: Observable<unknown> = scan.type === 'movie'
      ? this.movies.startScan(libraries, true, false, this.active.source)
      : this.tv.startScan({ libraryNames: libraries, source: this.active.source, showExisting: true, freshScan: false });
    start$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        scan.starting = false;
        scan.progress = { status: 'scanning', total: 0, processed: 0, libraries, error: null, completed_at: null };
        this.picker = null;
        scan.refresh.next();
      },
      error: err => {
        scan.starting = false;
        scan.error = err?.error?.error || 'Could not confirm the scan started. Check progress before trying again.';
        scan.refresh.next();
      },
    });
  }

  cancelScan(scan: ScanState): void {
    if (scan.starting || scan.cancelling || scan.progress?.status !== 'scanning') return;
    scan.cancelling = true;
    scan.error = '';
    this.service(scan).cancelScan().pipe(timeout(15000), takeUntilDestroyed(this.destroyRef)).subscribe({
      // Acknowledgement is not completion: keep polling until the server stops.
      next: () => scan.refresh.next(),
      error: () => {
        scan.cancelling = false;
        scan.error = 'Could not cancel the scan. It may still be running; try again.';
      },
    });
  }

  percent(scan: ScanState): number {
    const p = scan.progress;
    return p?.total ? Math.min(100, Math.max(0, Math.round(p.processed / p.total * 100))) : 0;
  }

  phase(scan: ScanState): string {
    if (scan.starting) return 'Loading libraries…';
    if (scan.cancelling) return 'Cancelling…';
    if (scan.progress?.status === 'done') return 'Scan complete';
    if (scan.progress?.status === 'cancelled') return 'Scan cancelled';
    if (scan.progress?.status === 'error') return 'Scan failed';
    if (scan.progress?.status === 'idle') return 'No scan running';
    if (scan.type === 'movie') return 'Checking movies';
    return scan.progress?.phase === 'franchises' ? 'Loading franchises'
      : scan.progress?.phase === 'titles' ? 'Checking titles' : 'Checking shows';
  }
}
