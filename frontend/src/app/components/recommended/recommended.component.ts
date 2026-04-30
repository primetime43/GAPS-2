import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { forkJoin, Subject, Subscription, timer } from 'rxjs';
import { catchError, filter, skip, switchMap, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { PlexService } from '../../services/plex.service';
import { JellyfinService } from '../../services/jellyfin.service';
import { EmbyService } from '../../services/emby.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService, ScanProgress } from '../../services/recommendation.service';
import { Movie } from '../../models/movie.model';
import { CollectionGap } from '../../models/recommendation.model';
import { ActiveServerResponse, MediaLibrary } from '../../models/media-server.model';
import { PreferencesService } from '../../services/preferences.service';
import { ExportService, ExportFormat } from '../../services/export.service';

interface CollectionGroup {
  name: string;
  gaps: CollectionGap[];
}

@Component({
    selector: 'app-recommended',
    templateUrl: './recommended.component.html',
    styleUrls: ['./recommended.component.scss'],
    standalone: false
})
export class RecommendedComponent implements OnInit, OnDestroy {
  libraries: MediaLibrary[] = [];
  selectedLibrary = '';
  selectedLibraries: string[] = [];
  movies: Movie[] = [];
  movieFilter = '';
  showOwned = false;
  hideFutureReleases = false;
  moviesPerPage = 50;
  currentPage = 1;
  searchFilter = '';
  posterPrefetch = false;

  get filteredMovies(): Movie[] {
    const query = this.movieFilter.trim().toLowerCase();
    const all = query ? this.movies.filter(m => m.name.toLowerCase().includes(query)) : this.movies;
    return all;
  }

  get pagedMovies(): Movie[] {
    const start = (this.currentPage - 1) * this.moviesPerPage;
    return this.filteredMovies.slice(start, start + this.moviesPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredMovies.length / this.moviesPerPage);
  }

  // All gaps from backend (always includes owned)
  allGaps: CollectionGap[] = [];
  // Filtered view
  collectionGroups: CollectionGroup[] = [];
  filteredGroups: CollectionGroup[] = [];
  // Ignored movies
  ignoredIds: Set<number> = new Set();
  showIgnored = false;
  selectedMovie: Movie | null = null;
  scanMode = false;
  crossCheckLibraries: string[] = [];

  // Media server source
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';

  // UI
  loading = true;
  loadingMovies = false;
  loadingGaps = false;
  hasServer = false;
  errorMessage = '';
  totalOwned = 0;
  missingCount = 0;

  // Scan progress
  scanProgress: ScanProgress | null = null;
  freshScanActive = false;
  showFreshScanConfirm = false;
  private pollSub: Subscription | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
    private preferencesService: PreferencesService,
    private exportService: ExportService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadContext(true);

    // Re-load context on every return to /recommended so prefs / server changes
    // made in Settings are picked up without a full page reload.
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      filter(e => e.urlAfterRedirects.split(/[?#]/)[0] === '/recommended'),
      skip(1),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadContext(false));
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadContext(autoSelectLibrary: boolean): void {
    this.recommendationService.getIgnored().pipe(
      catchError(() => of([]))
    ).subscribe(ids => this.ignoredIds = new Set(ids));

    this.preferencesService.load().pipe(
      catchError(() => of(null))
    ).subscribe((prefs) => {
      if (prefs) {
        this.moviesPerPage = prefs.moviesPerPage || 50;
        this.showOwned = !prefs.hideOwnedByDefault;
        this.hideFutureReleases = prefs.hideFutureReleasesByDefault || false;
        this.posterPrefetch = prefs.posterPrefetch || false;
      }
      this.detectActiveServer(prefs, autoSelectLibrary);
    });
  }

  private detectActiveServer(prefs: any, autoSelectLibrary: boolean): void {
    forkJoin({
      plex: this.plexService.getActiveServer().pipe(catchError(() => of(null))),
      jellyfin: this.jellyfinService.getActiveServer().pipe(catchError(() => of(null))),
      emby: this.embyService.getActiveServer().pipe(catchError(() => of(null))),
    }).subscribe((servers) => {
      let res: ActiveServerResponse | null = null;
      let source: 'plex' | 'jellyfin' | 'emby' = this.activeSource;

      if (servers.plex && (servers.plex as any).server) {
        res = servers.plex as ActiveServerResponse;
        source = 'plex';
      } else if (servers.jellyfin && (servers.jellyfin as any).server) {
        res = servers.jellyfin as ActiveServerResponse;
        source = 'jellyfin';
      } else if (servers.emby && (servers.emby as any).server) {
        res = servers.emby as ActiveServerResponse;
        source = 'emby';
      }

      if (res && res.server) {
        this.hasServer = true;
        this.activeSource = source;
        this.activeServerName = res.server;
        this.libraries = Array.isArray(res.libraries)
          ? res.libraries.filter((lib: MediaLibrary) => lib.type === 'movie')
          : [];

        if (autoSelectLibrary && prefs?.defaultLibrary && this.libraries.some(l => l.title === prefs.defaultLibrary)) {
          this.selectedLibrary = prefs.defaultLibrary;
          this.selectedLibraries = [prefs.defaultLibrary];
          this.onLibrarySelect();
        }
      } else {
        this.hasServer = false;
        this.activeServerName = '';
        this.libraries = [];
      }
      this.loading = false;
    });
  }

  onLibrarySelect(): void {
    if (!this.selectedLibrary) return;
    // Keep selectedLibraries in sync when using the dropdown
    if (!this.selectedLibraries.includes(this.selectedLibrary)) {
      this.selectedLibraries = [this.selectedLibrary];
    }
    this.loadingMovies = true;
    this.movies = [];
    this.movieFilter = '';
    this.allGaps = [];
    this.collectionGroups = [];
    this.selectedMovie = null;
    this.scanMode = false;
    this.errorMessage = '';

    this.libraryService.getMovies(this.selectedLibrary, this.activeSource).subscribe({
      next: (res: any) => {
        if (res.error) {
          this.errorMessage = this.friendlyError(res.error);
          this.loadingMovies = false;
          return;
        }
        this.movies = Array.isArray(res) ? res : (res.movies || []);
        this.loadingMovies = false;
        this.prefetchNextPage();
      },
      error: (err) => {
        this.errorMessage = this.friendlyError(err.error?.error || 'Failed to load movies from library.');
        this.loadingMovies = false;
      }
    });
  }

  toggleLibrarySelection(libTitle: string): void {
    const idx = this.selectedLibraries.indexOf(libTitle);
    if (idx >= 0) {
      this.selectedLibraries.splice(idx, 1);
    } else {
      this.selectedLibraries.push(libTitle);
    }
  }

  isLibrarySelected(libTitle: string): boolean {
    return this.selectedLibraries.includes(libTitle);
  }

  scanLibrary(freshScan = false): void {
    if (freshScan) {
      this.showFreshScanConfirm = true;
      return;
    }
    this.startScan(false);
  }

  onFreshScanConfirm(): void {
    this.showFreshScanConfirm = false;
    this.startScan(true);
  }

  onFreshScanCancel(): void {
    this.showFreshScanConfirm = false;
  }

  private startScan(freshScan: boolean): void {
    this.freshScanActive = freshScan;
    this.scanMode = true;
    this.selectedMovie = null;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.scanProgress = null;
    this.errorMessage = '';

    const scanLibraries = this.selectedLibraries.length > 0 ? this.selectedLibraries : [this.selectedLibrary];

    // Pre-load movies for all selected libraries so the backend has them cached
    const loadRequests = scanLibraries.map(lib =>
      this.libraryService.getMovies(lib, this.activeSource).pipe(catchError(() => of({ movies: [] })))
    );

    forkJoin(loadRequests).subscribe({
      next: () => {
        this.recommendationService.startScan(scanLibraries, true, freshScan, this.activeSource).subscribe({
          next: () => {
            this.startPolling();
          },
          error: (err) => {
            this.errorMessage = err.error?.error || 'Failed to start scan.';
            this.loadingGaps = false;
          }
        });
      },
      error: () => {
        this.errorMessage = 'Failed to load movies from selected libraries.';
        this.loadingGaps = false;
      }
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollSub = timer(0, 1000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.recommendationService.getScanProgress()),
    ).subscribe({
        next: (progress) => {
          this.scanProgress = progress;

          if (progress.status === 'done') {
            this.stopPolling();
            this.allGaps = progress.gaps;
            this.totalOwned = progress.total_owned;
            this.applyFilter();
            this.loadingGaps = false;
            this.scanProgress = null;
          } else if (progress.status === 'error') {
            this.stopPolling();
            this.errorMessage = progress.error || 'Scan failed.';
            this.loadingGaps = false;
            this.scanProgress = null;
          }
        },
        error: () => {
          // Ignore transient polling errors
        }
      });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  selectMovie(movie: Movie): void {
    this.selectedMovie = movie;
    this.scanMode = false;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.crossCheckLibraries = [];
    this.errorMessage = '';

    this.fetchGapsForSelectedMovie();
  }

  toggleCrossCheckLibrary(libTitle: string): void {
    const idx = this.crossCheckLibraries.indexOf(libTitle);
    if (idx >= 0) {
      this.crossCheckLibraries.splice(idx, 1);
    } else {
      this.crossCheckLibraries.push(libTitle);
      // Pre-load movies for that library so the backend has them cached
      this.libraryService.getMovies(libTitle, this.activeSource).subscribe();
    }
  }

  recheckWithLibraries(): void {
    this.loadingGaps = true;
    this.errorMessage = '';
    this.fetchGapsForSelectedMovie();
  }

  private fetchGapsForSelectedMovie(): void {
    if (!this.selectedMovie) return;

    // Always fetch with showExisting=true; backend uses fallback chain for ID resolution
    this.recommendationService.getGapsForMovie(
      this.selectedMovie,
      this.selectedLibrary,
      true,
      this.activeSource,
      this.crossCheckLibraries
    ).subscribe({
      next: (gaps) => {
        this.allGaps = gaps;
        // Auto-show owned if collection is complete (no missing movies)
        if (gaps.length > 0 && gaps.every(g => g.owned)) {
          this.showOwned = true;
        }
        this.applyFilter();
        this.loadingGaps = false;
      },
      error: () => {
        this.errorMessage = 'Failed to find collection gaps.';
        this.loadingGaps = false;
      }
    });
  }

  onShowOwnedChange(): void {
    this.applyFilter();
  }

  onHideFutureReleasesChange(): void {
    this.applyFilter();
  }

  isFutureRelease(gap: CollectionGap): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (gap.releaseDate) {
      return gap.releaseDate > today;
    }
    // No release date set on TMDB — treat as unannounced/future
    return true;
  }

  isIgnored(gap: CollectionGap): boolean {
    return this.ignoredIds.has(gap.tmdbId);
  }

  toggleIgnore(gap: CollectionGap, event: Event): void {
    event.stopPropagation();
    if (this.ignoredIds.has(gap.tmdbId)) {
      this.ignoredIds.delete(gap.tmdbId);
      this.recommendationService.removeIgnored(gap.tmdbId).subscribe({
        error: () => this.ignoredIds.add(gap.tmdbId)
      });
    } else {
      this.ignoredIds.add(gap.tmdbId);
      this.recommendationService.addIgnored(gap.tmdbId).subscribe({
        error: () => this.ignoredIds.delete(gap.tmdbId)
      });
    }
    this.applyFilter();
  }

  ignoreCollection(group: CollectionGroup, event: Event): void {
    event.stopPropagation();
    const idsToIgnore = group.gaps
      .filter(g => !g.owned && !this.ignoredIds.has(g.tmdbId))
      .map(g => g.tmdbId);
    if (idsToIgnore.length === 0) return;
    for (const id of idsToIgnore) {
      this.ignoredIds.add(id);
    }
    this.recommendationService.addIgnoredBulk(idsToIgnore).subscribe({
      error: () => { for (const id of idsToIgnore) this.ignoredIds.delete(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  unignoreCollection(group: CollectionGroup, event: Event): void {
    event.stopPropagation();
    const idsToUnignore = group.gaps
      .filter(g => this.ignoredIds.has(g.tmdbId))
      .map(g => g.tmdbId);
    if (idsToUnignore.length === 0) return;
    for (const id of idsToUnignore) {
      this.ignoredIds.delete(id);
    }
    this.recommendationService.removeIgnoredBulk(idsToUnignore).subscribe({
      error: () => { for (const id of idsToUnignore) this.ignoredIds.add(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  collectionHasUnignoredGaps(group: CollectionGroup): boolean {
    return group.gaps.some(g => !g.owned && !this.ignoredIds.has(g.tmdbId));
  }

  onShowIgnoredChange(): void {
    this.applyFilter();
  }

  clearResults(): void {
    this.selectedMovie = null;
    this.scanMode = false;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.searchFilter = '';
    this.errorMessage = '';
  }

  exportResults(format: ExportFormat): void {
    const gaps = this.filteredGroups.flatMap(g => g.gaps);
    this.exportService.exportGaps(gaps, format);
  }

  private friendlyError(msg: string): string {
    const lower = msg.toLowerCase();
    if (lower.includes('server not found') || lower.includes('no active server')) {
      return `${msg}. Your media server session may have expired — try reconnecting in Settings.`;
    }
    if (lower.includes('not connected')) {
      return `${msg}. Your media server is not connected — check your configuration in Settings.`;
    }
    if (lower.includes('invalid token') || lower.includes('unauthorized')) {
      return `${msg}. Your authentication token may have expired — try logging in again in Settings.`;
    }
    return msg;
  }

  onPageChange(delta: number): void {
    this.currentPage += delta;
    this.prefetchNextPage();
  }

  prefetchNextPage(): void {
    if (!this.posterPrefetch) return;
    const nextPage = this.currentPage + 1;
    if (nextPage > this.totalPages) return;
    const start = (nextPage - 1) * this.moviesPerPage;
    const nextMovies = this.filteredMovies.slice(start, start + this.moviesPerPage);
    for (const movie of nextMovies) {
      if (movie.posterUrl) {
        const img = new Image();
        img.src = movie.posterUrl;
      }
    }
  }

  applyFilter(): void {
    let filtered = this.showOwned
      ? this.allGaps
      : this.allGaps.filter(g => !g.owned);

    if (!this.showIgnored) {
      filtered = filtered.filter(g => !this.ignoredIds.has(g.tmdbId));
    }

    if (this.hideFutureReleases) {
      filtered = filtered.filter(g => g.owned || !this.isFutureRelease(g));
    }

    this.missingCount = this.allGaps.filter(g =>
      !g.owned
      && !this.ignoredIds.has(g.tmdbId)
      && (!this.hideFutureReleases || !this.isFutureRelease(g))
    ).length;

    const groups = new Map<string, CollectionGap[]>();
    for (const gap of filtered) {
      const name = gap.collectionName;
      if (!groups.has(name)) {
        groups.set(name, []);
      }
      groups.get(name)!.push(gap);
    }
    this.collectionGroups = Array.from(groups.entries()).map(([name, gaps]) => ({ name, gaps }));

    // Apply search filter
    const query = this.searchFilter.trim().toLowerCase();
    if (!query) {
      this.filteredGroups = this.collectionGroups;
    } else {
      this.filteredGroups = this.collectionGroups
        .map(group => ({
          name: group.name,
          gaps: group.gaps.filter(g =>
            g.name.toLowerCase().includes(query) ||
            g.collectionName.toLowerCase().includes(query)
          )
        }))
        .filter(group => group.gaps.length > 0);
    }
  }
}
