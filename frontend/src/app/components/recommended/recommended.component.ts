import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { forkJoin, Observable, Subject, Subscription, timer } from 'rxjs';
import { catchError, filter, map, skip, switchMap, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { ActiveServerService } from '../../services/active-server.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TvdbService } from '../../services/tvdb.service';
import { Gap } from '../../models/recommendation.model';
import { MediaLibrary } from '../../models/media-server.model';
import { PreferencesService } from '../../services/preferences.service';
import { ExportService, ExportFormat } from '../../services/export.service';
import { RadarrService } from '../../services/radarr.service';
import { SonarrService } from '../../services/sonarr.service';
import { ImdbService } from '../../services/imdb.service';
import { TmdbService, TmdbGenre } from '../../services/tmdb/tmdb.service';
import { environment } from '../../../environments/environment';

type MediaType = 'movie' | 'tv';
// "Downloaders" — the *arr integration a gap can be sent to. Movies → Radarr,
// TV → Sonarr; the active one always follows the current mediaType.
type Downloader = 'radarr' | 'sonarr';
type SendState = 'sending' | 'sent' | 'error';

interface BrowseItem {
  name: string;
  year: number | string;
  posterUrl: string | null;
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number | string;
}

interface GapGroup {
  name: string;
  gaps: Gap[];
}

interface UnifiedProgress {
  label: string;        // main status line ("Checking your shows... 120 / 658")
  percent: number;      // 0–100 for the current phase
  currentLabel: string; // sub-line ("Checking: <title>")
  groupsFound: number;
  groupsLabel: string;  // "collections found" | "franchises found"
}

// Per-integration behavior for the generic "send to *arr" plumbing.
interface DownloaderDef {
  label: string;
  addHint: string;
  getConfig: () => Observable<any>;
  ownedIds: () => Observable<number[]>;
  add: (gap: Gap) => Observable<any>;
  eligible: (gap: Gap) => boolean;
}

@Component({
    selector: 'app-recommended',
    templateUrl: './recommended.component.html',
    styleUrls: ['./recommended.component.scss'],
    standalone: false
})
export class RecommendedComponent implements OnInit, OnDestroy {
  // Movies vs TV shows — swaps the data source for the whole view.
  mediaType: MediaType = 'movie';

  libraries: MediaLibrary[] = [];
  selectedLibrary = '';
  selectedLibraries: string[] = [];
  items: BrowseItem[] = [];
  itemFilter = '';
  // Primary owned/missing selector + secondary "show future" toggle — the same
  // filter bar the Actors view uses.
  view: 'all' | 'owned' | 'missing' = 'all';
  showFuture = true;
  // Quality filter (movies only) — exclude low-tier gaps by TMDB rating / vote
  // count. Set before scanning; applied server-side so the gaps are excluded
  // from the scan (and from scheduled scans, which share the same setting).
  qualityFilter = false;
  minRating = 0;
  minVoteCount = 0;
  // "Advanced" disclosure for the quality filter — collapsed by default.
  showAdvanced = false;
  itemsPerPage = 50;
  currentPage = 1;
  searchFilter = '';
  posterPrefetch = false;

  // Where movie poster/title clicks go. IMDb links route through the backend,
  // which resolves the IMDb ID lazily. TV always links to TheTVDB.
  externalLinkProvider: 'tmdb' | 'imdb' = 'tmdb';

  // Results sort + genre filter (reuse fields already on each gap).
  sortBy: 'default' | 'rating' | 'popularity' | 'year' | 'name' = 'default';
  genreFilter: number | null = null;
  genres: TmdbGenre[] = [];
  availableGenres: TmdbGenre[] = [];

  get filteredItems(): BrowseItem[] {
    const query = this.itemFilter.trim().toLowerCase();
    return query ? this.items.filter(m => m.name.toLowerCase().includes(query)) : this.items;
  }

  get pagedItems(): BrowseItem[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredItems.slice(start, start + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredItems.length / this.itemsPerPage);
  }

  // All gaps from backend (normalized; always includes owned)
  allGaps: Gap[] = [];
  collectionGroups: GapGroup[] = [];
  filteredGroups: GapGroup[] = [];
  // Ignored items (TMDB ids for movies, TheTVDB ids for shows — reloaded on toggle)
  ignoredIds: Set<number> = new Set();
  showIgnored = false;
  selectedItem: BrowseItem | null = null;
  scanMode = false;
  crossCheckLibraries: string[] = [];

  // Media server source
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';

  // TheTVDB availability (TV mode)
  tvdbEnabled = false;

  // UI
  loading = true;
  loadingItems = false;
  loadingGaps = false;
  hasServer = false;
  errorMessage = '';
  totalOwned = 0;
  ownedCount = 0;
  missingCount = 0;

  // Scan progress (normalized across movie/TV scans)
  scanProgress: UnifiedProgress | null = null;
  freshScanActive = false;
  showFreshScanConfirm = false;

  // Radarr (movies) / Sonarr (TV) send state, keyed by downloader.
  private downloaders: Record<Downloader, {
    enabled: boolean;
    status: Map<number, SendState>;
    errors: Map<number, string>;
  }> = {
    radarr: { enabled: false, status: new Map(), errors: new Map() },
    sonarr: { enabled: false, status: new Map(), errors: new Map() },
  };

  private completedScans = new Map<string, { gaps: Gap[]; totalOwned: number }>();
  private pollSub: Subscription | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private activeServerService: ActiveServerService,
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
    private tvdb: TvdbService,
    private preferencesService: PreferencesService,
    private exportService: ExportService,
    private radarrService: RadarrService,
    private sonarrService: SonarrService,
    private imdbService: ImdbService,
    private tmdbService: TmdbService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.tmdbService.getGenres().pipe(catchError(() => of([] as TmdbGenre[]))).subscribe(g => {
      this.genres = g;
      this.updateAvailableGenres();
    });
    this.loadContext(true);

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

  setMediaType(type: MediaType): void {
    if (this.mediaType === type) return;
    // Cancel any in-flight scan for the current media type so it doesn't keep
    // running on the backend after we switch away from it.
    if (this.loadingGaps && this.scanMode) {
      const cancel$ = this.mediaType === 'tv'
        ? this.tvdb.cancelScan()
        : this.recommendationService.cancelScan();
      cancel$.subscribe({ next: () => {}, error: () => {} });
    }
    this.mediaType = type;
    this.stopPolling();
    this.selectedLibrary = '';
    this.selectedLibraries = [];
    this.items = [];
    this.itemFilter = '';
    this.currentPage = 1;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.selectedItem = null;
    this.scanMode = false;
    this.scanProgress = null;
    this.loadingGaps = false;
    this.loadingItems = false;
    this.searchFilter = '';
    this.errorMessage = '';
    // The genre filter is movie-only; clear it so it can't hide all TV results.
    this.genreFilter = null;
    this.availableGenres = [];
    this.loadIgnored();
    this.applyLibraryFilter();
  }

  private isTvLibrary(lib: MediaLibrary): boolean {
    return lib.type === 'show' || lib.type === 'tvshows';
  }

  // -- Context / init --

  private loadContext(autoSelectLibrary: boolean): void {
    this.loadIgnored();
    this.refreshDownloaderStatus('radarr');
    this.refreshDownloaderStatus('sonarr');
    this.tvdb.getConfig().pipe(catchError(() => of(null))).subscribe(cfg => {
      this.tvdbEnabled = !!(cfg && cfg.enabled);
    });

    this.preferencesService.load().pipe(
      catchError(() => of(null))
    ).subscribe((prefs) => {
      if (prefs) {
        this.itemsPerPage = prefs.moviesPerPage || 50;
        this.view = prefs.hideOwnedByDefault ? 'missing' : 'all';
        this.showFuture = !prefs.hideFutureReleasesByDefault;
        this.posterPrefetch = prefs.posterPrefetch || false;
        this.qualityFilter = prefs.qualityFilterEnabled || false;
        this.minRating = prefs.minRating || 0;
        this.minVoteCount = prefs.minVoteCount || 0;
        this.externalLinkProvider = prefs.externalLinkProvider || 'tmdb';
      }
      this.detectActiveServer(prefs, autoSelectLibrary);
    });
  }

  private loadIgnored(): void {
    const src$ = this.mediaType === 'tv' ? this.tvdb.getIgnored() : this.recommendationService.getIgnored();
    src$.pipe(catchError(() => of([]))).subscribe(ids => this.ignoredIds = new Set(ids));
  }

  private allServerLibraries: MediaLibrary[] = [];

  private detectActiveServer(prefs: any, autoSelectLibrary: boolean): void {
    this.activeServerService.getActive().subscribe((active) => {
      if (active) {
        this.hasServer = true;
        this.activeSource = active.source;
        this.activeServerName = active.server;
        this.allServerLibraries = active.libraries;
        this.applyLibraryFilter();
        this.finishInitialization(prefs, autoSelectLibrary);
      } else {
        this.hasServer = false;
        this.activeServerName = '';
        this.allServerLibraries = [];
        this.libraries = [];
        this.loading = false;
      }
    });
  }

  private applyLibraryFilter(): void {
    this.libraries = this.allServerLibraries.filter(lib =>
      this.mediaType === 'tv' ? this.isTvLibrary(lib) : lib.type === 'movie'
    );
  }

  private finishInitialization(prefs: any, autoSelectLibrary: boolean): void {
    if (this.scanProgress || this.selectedItem) {
      if (autoSelectLibrary) this.applyDefaultLibrary(prefs);
      this.loading = false;
      return;
    }

    if (!autoSelectLibrary) {
      this.loading = false;
      return;
    }

    // Restore the last movie scan on first load (movies only — TV re-scans are cheap).
    if (this.mediaType !== 'movie') {
      this.applyDefaultLibrary(prefs);
      this.loading = false;
      return;
    }

    this.recommendationService.getScanProgress().pipe(
      catchError(() => of(null))
    ).subscribe((progress) => {
      const validScan = !!(progress && progress.status === 'done' && progress.gaps?.length);
      const scanLibs = validScan ? (progress!.libraries || []) : [];

      if (scanLibs.length && this.libraries.some(l => scanLibs.includes(l.title))) {
        this.selectedLibrary = scanLibs[0];
        this.selectedLibraries = [...scanLibs];
        this.onLibrarySelect();
      } else {
        this.applyDefaultLibrary(prefs);
      }

      if (validScan) {
        this.allGaps = this.normalizeGaps(progress!.gaps);
        this.totalOwned = progress!.total_owned;
        this.scanMode = true;
        this.applyFilter();
        this.loadImdbRatings();
        this.cacheCompletedScan(scanLibs, this.allGaps, progress!.total_owned);
      }
      this.loading = false;
    });
  }

  private applyDefaultLibrary(prefs: any): void {
    if (prefs?.defaultLibrary && this.libraries.some(l => l.title === prefs.defaultLibrary)) {
      this.selectedLibrary = prefs.defaultLibrary;
      this.selectedLibraries = [prefs.defaultLibrary];
      this.onLibrarySelect();
    }
  }

  // -- Library selection / browse --

  onLibrarySelect(): void {
    if (!this.selectedLibrary) return;
    if (!this.selectedLibraries.includes(this.selectedLibrary)) {
      this.selectedLibraries = [this.selectedLibrary];
    }
    this.items = [];
    this.itemFilter = '';
    this.allGaps = [];
    this.collectionGroups = [];
    this.selectedItem = null;
    this.scanMode = false;
    this.errorMessage = '';

    this.tryRestoreScanForCurrentSelection();

    this.loadingItems = !this.scanMode;
    const load$: Observable<any> = this.mediaType === 'tv'
      ? this.libraryService.getShows(this.selectedLibrary, this.activeSource)
      : this.libraryService.getMovies(this.selectedLibrary, this.activeSource);
    load$.subscribe({
      next: (res: any) => {
        if (res.error) {
          this.errorMessage = this.friendlyError(res.error);
          this.loadingItems = false;
          return;
        }
        this.items = Array.isArray(res) ? res : (res.movies || res.shows || []);
        this.loadingItems = false;
        this.prefetchNextPage();
      },
      error: (err) => {
        this.errorMessage = this.friendlyError(err.error?.error || 'Failed to load library.');
        this.loadingItems = false;
      }
    });
  }

  private tryRestoreScanForCurrentSelection(): void {
    const key = this.scanKey(this.selectedLibraries);
    if (!key) return;
    const cached = this.completedScans.get(key);
    if (!cached?.gaps?.length) return;
    this.allGaps = cached.gaps;
    this.totalOwned = cached.totalOwned;
    this.scanMode = true;
    this.applyFilter();
    this.loadImdbRatings();
  }

  private cacheCompletedScan(libraries: string[], gaps: Gap[], totalOwned: number): void {
    const key = this.scanKey(libraries);
    if (!key) return;
    this.completedScans.set(key, { gaps, totalOwned });
  }

  private scanKey(libraries: string[]): string {
    if (!libraries?.length) return '';
    return `${this.mediaType}:` + [...libraries].sort().join('|');
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

  // -- Scan --

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
    this.selectedItem = null;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.scanProgress = null;
    this.errorMessage = '';

    const scanLibraries = this.selectedLibraries.length > 0 ? this.selectedLibraries : [this.selectedLibrary];

    if (this.mediaType === 'tv') {
      this.tvdb.startScan({
        source: this.activeSource,
        libraryNames: scanLibraries,
        showExisting: true,
        freshScan,
      }).subscribe({
        next: () => this.startPolling(scanLibraries),
        error: (err) => {
          this.errorMessage = err.error?.error || 'Failed to start scan.';
          this.loadingGaps = false;
        }
      });
      return;
    }

    // Persist the quality filter first so the backend (which filters at scan
    // time) excludes low-tier movies from this scan. Proceed even if the save
    // fails — the scan should still run.
    this.saveQualityPrefs().pipe(catchError(() => of(null))).subscribe(() => {
      // Movies: pre-load movies for all selected libraries so the backend has them cached.
      const loadRequests = scanLibraries.map(lib =>
        this.libraryService.getMovies(lib, this.activeSource).pipe(catchError(() => of({ movies: [] })))
      );
      forkJoin(loadRequests).subscribe({
        next: () => {
          this.recommendationService.startScan(scanLibraries, true, freshScan, this.activeSource).subscribe({
            next: () => this.startPolling(scanLibraries),
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
    });
  }

  private startPolling(scanLibraries: string[]): void {
    this.stopPolling();
    this.pollSub = timer(0, this.mediaType === 'tv' ? 1500 : 1000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.mediaType === 'tv'
        ? this.tvdb.getScanProgress()
        : this.recommendationService.getScanProgress()),
    ).subscribe({
        next: (progress: any) => {
          this.scanProgress = this.normalizeProgress(progress);

          if (progress.status === 'done') {
            this.stopPolling();
            this.allGaps = this.normalizeGaps(progress.gaps);
            this.totalOwned = progress.total_owned;
            this.applyFilter();
            this.loadImdbRatings();
            this.loadingGaps = false;
            this.scanProgress = null;
            const scanLibs = progress.libraries?.length ? progress.libraries : [...scanLibraries];
            this.cacheCompletedScan(scanLibs, this.allGaps, progress.total_owned);
          } else if (progress.status === 'error') {
            this.stopPolling();
            this.errorMessage = progress.error || 'Scan failed.';
            this.loadingGaps = false;
            this.scanProgress = null;
          } else if (progress.status === 'cancelled' || progress.status === 'idle') {
            this.stopPolling();
            this.loadingGaps = false;
            this.scanProgress = null;
            this.scanMode = false;
          }
        },
        error: () => {}
      });
  }

  stopScan(): void {
    const cancel$ = this.mediaType === 'tv' ? this.tvdb.cancelScan() : this.recommendationService.cancelScan();
    cancel$.subscribe({ next: () => {}, error: () => {} });
    this.stopPolling();
    this.loadingGaps = false;
    this.scanProgress = null;
    this.scanMode = false;
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  private normalizeProgress(p: any): UnifiedProgress {
    const processed = p.processed || 0;
    const total = p.total || 0;
    const percent = total ? (processed / total * 100) : 0;

    if (this.mediaType === 'tv') {
      const phase = p.phase || 'shows';
      const phaseLabel = phase === 'franchises'
        ? 'Loading franchises'
        : phase === 'titles'
          ? 'Fetching missing titles'
          : 'Checking your shows';
      return {
        label: `${phaseLabel}... ${processed} / ${total}`,
        percent,
        currentLabel: phase === 'shows' ? (p.current_show || '') : '',
        groupsFound: p.franchises_found || 0,
        groupsLabel: 'franchises found',
      };
    }

    return {
      label: `Scanning movies... ${processed} / ${total}`,
      percent,
      currentLabel: p.current_movie || '',
      groupsFound: p.collections_found || 0,
      groupsLabel: 'collections found',
    };
  }

  // -- Single-item lookup --

  selectItem(item: BrowseItem): void {
    this.selectedItem = item;
    this.scanMode = false;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.crossCheckLibraries = [];
    this.errorMessage = '';
    this.fetchGapsForSelectedItem();
  }

  toggleCrossCheckLibrary(libTitle: string): void {
    const idx = this.crossCheckLibraries.indexOf(libTitle);
    if (idx >= 0) {
      this.crossCheckLibraries.splice(idx, 1);
    } else {
      this.crossCheckLibraries.push(libTitle);
      this.libraryService.getMovies(libTitle, this.activeSource).subscribe();
    }
  }

  recheckWithLibraries(): void {
    this.loadingGaps = true;
    this.errorMessage = '';
    this.fetchGapsForSelectedItem();
  }

  private fetchGapsForSelectedItem(): void {
    if (!this.selectedItem) return;

    if (this.mediaType === 'tv') {
      const tvdbId = this.selectedItem.tvdbId;
      if (typeof tvdbId !== 'number') {
        this.errorMessage = `"${this.selectedItem.name}" has no TheTVDB ID, so its franchise can't be looked up.`;
        this.loadingGaps = false;
        return;
      }
      const libs = this.selectedLibraries.length ? this.selectedLibraries : [this.selectedLibrary];
      this.tvdb.getGapsForShow(tvdbId, libs, true, this.activeSource).subscribe({
        next: (gaps) => {
          this.allGaps = this.normalizeGaps(gaps);
          if (this.allGaps.length > 0 && this.allGaps.every(g => g.owned)) this.view = 'all';
          this.applyFilter();
          this.loadingGaps = false;
        },
        error: () => {
          this.errorMessage = 'Failed to find franchise gaps.';
          this.loadingGaps = false;
        }
      });
      return;
    }

    this.recommendationService.getGapsForMovie(
      this.selectedItem as any,
      this.selectedLibrary,
      true,
      this.activeSource,
      this.crossCheckLibraries
    ).subscribe({
      next: (gaps) => {
        this.allGaps = this.normalizeGaps(gaps);
        if (this.allGaps.length > 0 && this.allGaps.every(g => g.owned)) this.view = 'all';
        this.applyFilter();
        this.loadImdbRatings();
        this.loadingGaps = false;
      },
      error: () => {
        this.errorMessage = 'Failed to find collection gaps.';
        this.loadingGaps = false;
      }
    });
  }

  // -- Gap normalization --

  private normalizeGaps(raw: any[]): Gap[] {
    if (!Array.isArray(raw)) return [];
    if (this.mediaType === 'tv') {
      return raw.map(g => ({
        id: g.tvdbId,
        name: g.name,
        year: g.year,
        releaseDate: g.releaseDate,
        posterUrl: g.posterUrl ?? null,
        overview: g.overview || '',
        groupName: g.franchiseName || 'Unknown franchise',
        owned: !!g.owned,
        externalUrl: g.slug ? `https://thetvdb.com/series/${g.slug}` : 'https://thetvdb.com',
        radarrEligible: false,
        sonarrEligible: !!g.tvdbId,
      }));
    }
    return raw.map(g => ({
      id: g.tmdbId,
      name: g.name,
      year: g.year,
      releaseDate: g.releaseDate,
      posterUrl: g.posterUrl ?? null,
      overview: g.overview || '',
      groupName: g.collectionName || 'Unknown Collection',
      owned: !!g.owned,
      externalUrl: this.movieExternalUrl(g.tmdbId),
      radarrEligible: !!g.tmdbId,
      sonarrEligible: false,
      tmdbRating: g.voteAverage > 0 ? g.voteAverage : undefined,
      tmdbVotes: g.voteCount || undefined,
      genreIds: g.genreIds || [],
      popularity: g.popularity || 0,
    }));
  }

  /** Build the poster/title link for a movie, honoring the IMDb preference. */
  private movieExternalUrl(tmdbId: number | null | undefined): string {
    if (!tmdbId) return '';
    return this.externalLinkProvider === 'imdb'
      ? `${environment.apiUrl}/tmdb/movie/${tmdbId}/imdb`
      : `https://www.themoviedb.org/movie/${tmdbId}`;
  }

  /**
   * Live results-page switch between TMDB/IMDb links. Recomputes movie links in
   * place and persists the choice as the new default (mirrors the gap filters).
   */
  onLinkProviderChange(): void {
    if (this.mediaType === 'movie') {
      for (const gap of this.allGaps) gap.externalUrl = this.movieExternalUrl(gap.id);
    }
    this.preferencesService.save({ externalLinkProvider: this.externalLinkProvider })
      .subscribe({ next: () => {}, error: () => {} });
  }

  /**
   * Best-effort fetch of IMDb ratings for the current movie gaps. The backend
   * returns nothing unless the IMDb integration is enabled, so we always ask
   * rather than caching an enabled flag (which would go stale under route reuse).
   */
  private loadImdbRatings(): void {
    if (this.mediaType !== 'movie') return;
    const ids = this.allGaps.map(g => g.id).filter((id): id is number => !!id);
    if (!ids.length) return;
    this.imdbService.getRatings(ids).pipe(
      catchError(() => of({ ratings: {} as Record<string, any> }))
    ).subscribe(res => {
      const ratings = res.ratings || {};
      for (const gap of this.allGaps) {
        const r = ratings[String(gap.id)];
        if (r) {
          gap.imdbRating = r.aggregateRating;
          gap.imdbVotes = r.voteCount;
        }
      }
    });
  }

  // -- Filters --

  onFilterChange(): void { this.applyFilter(); }

  /** Sort a gap list by the selected key, leaving the source array untouched. */
  private sortGaps(list: Gap[]): Gap[] {
    switch (this.sortBy) {
      case 'rating': return [...list].sort((a, b) => (b.tmdbRating || 0) - (a.tmdbRating || 0));
      case 'popularity': return [...list].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      case 'year': return [...list].sort((a, b) => this.yearNum(b) - this.yearNum(a));
      case 'name': return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      default: return list;
    }
  }

  private yearNum(g: Gap): number {
    const y = parseInt(String(g.year), 10);
    return isNaN(y) ? 0 : y;
  }

  /** Genres actually present in the current results, for the filter dropdown. */
  private updateAvailableGenres(): void {
    if (!this.genres.length || !this.allGaps.length) { this.availableGenres = []; return; }
    const present = new Set<number>();
    for (const g of this.allGaps) (g.genreIds || []).forEach(id => present.add(id));
    this.availableGenres = this.genres
      .filter(gen => present.has(gen.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  setView(view: 'all' | 'owned' | 'missing'): void {
    this.view = view;
    this.applyFilter();
  }

  /**
   * Persist the quality-filter settings. This is a scan-time filter applied
   * server-side, so saving it (which reloads the TMDB service) makes the next
   * scan — manual or scheduled — exclude low-tier movies. Fire-and-forget on
   * change so scheduled scans honor it even without a manual scan.
   */
  private saveQualityPrefs() {
    return this.preferencesService.save({
      qualityFilterEnabled: this.qualityFilter,
      minRating: this.minRating || 0,
      minVoteCount: this.minVoteCount || 0,
    });
  }

  onQualityFilterChange(): void {
    this.saveQualityPrefs().subscribe({ next: () => {}, error: () => {} });
  }

  // NOTE: mirrored on the backend by `_is_future_release` in
  // backend/app/services/scan_history.py (used so scheduled scans count gaps
  // the same way). Keep the two in sync if this logic changes.
  isFutureRelease(gap: Gap): boolean {
    const today = new Date().toISOString().slice(0, 10);
    // Prefer an exact date (movie release date or TV first-aired date).
    if (gap.releaseDate) return gap.releaseDate > today;
    if (this.mediaType === 'movie') return true; // no date → unannounced/future
    // TV with no first-aired date: fall back to the year.
    const year = parseInt(String(gap.year), 10);
    return year ? year > new Date().getFullYear() : false;
  }

  isIgnored(gap: Gap): boolean {
    return this.ignoredIds.has(gap.id);
  }

  toggleIgnore(gap: Gap, event: Event): void {
    event.stopPropagation();
    if (this.ignoredIds.has(gap.id)) {
      this.ignoredIds.delete(gap.id);
      this.ignoreRemove(gap.id).subscribe({ error: () => this.ignoredIds.add(gap.id) });
    } else {
      this.ignoredIds.add(gap.id);
      this.ignoreAdd(gap.id).subscribe({ error: () => this.ignoredIds.delete(gap.id) });
    }
    this.applyFilter();
  }

  ignoreCollection(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => !g.owned && !this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.add(id);
    this.ignoreAddBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.delete(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  unignoreCollection(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.delete(id);
    this.ignoreRemoveBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.add(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  collectionHasUnignoredGaps(group: GapGroup): boolean {
    return group.gaps.some(g => !g.owned && !this.ignoredIds.has(g.id));
  }

  private ignoreAdd(id: number) {
    return this.mediaType === 'tv' ? this.tvdb.addIgnored(id) : this.recommendationService.addIgnored(id);
  }
  private ignoreAddBulk(ids: number[]) {
    return this.mediaType === 'tv' ? this.tvdb.addIgnoredBulk(ids) : this.recommendationService.addIgnoredBulk(ids);
  }
  private ignoreRemove(id: number) {
    return this.mediaType === 'tv' ? this.tvdb.removeIgnored(id) : this.recommendationService.removeIgnored(id);
  }
  private ignoreRemoveBulk(ids: number[]) {
    return this.mediaType === 'tv' ? this.tvdb.removeIgnoredBulk(ids) : this.recommendationService.removeIgnoredBulk(ids);
  }

  clearResults(): void {
    this.selectedItem = null;
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
    const start = (nextPage - 1) * this.itemsPerPage;
    const nextItems = this.filteredItems.slice(start, start + this.itemsPerPage);
    for (const item of nextItems) {
      if (item.posterUrl) {
        const img = new Image();
        img.src = item.posterUrl;
      }
    }
  }

  applyFilter(): void {
    let filtered = this.allGaps;
    if (this.view === 'owned') {
      filtered = filtered.filter(g => g.owned);
    } else if (this.view === 'missing') {
      filtered = filtered.filter(g => !g.owned);
    }

    if (!this.showIgnored) {
      filtered = filtered.filter(g => !this.ignoredIds.has(g.id));
    }

    if (!this.showFuture) {
      filtered = filtered.filter(g => g.owned || !this.isFutureRelease(g));
    }

    this.ownedCount = this.allGaps.filter(g => g.owned).length;
    this.missingCount = this.allGaps.filter(g =>
      !g.owned
      && !this.ignoredIds.has(g.id)
      && (this.showFuture || !this.isFutureRelease(g))
    ).length;

    if (this.genreFilter != null) {
      filtered = filtered.filter(g => (g.genreIds || []).includes(this.genreFilter as number));
    }
    filtered = this.sortGaps(filtered);

    const groups = new Map<string, Gap[]>();
    for (const gap of filtered) {
      if (!groups.has(gap.groupName)) groups.set(gap.groupName, []);
      groups.get(gap.groupName)!.push(gap);
    }
    this.collectionGroups = Array.from(groups.entries()).map(([name, gaps]) => ({ name, gaps }));
    this.updateAvailableGenres();

    const query = this.searchFilter.trim().toLowerCase();
    if (!query) {
      this.filteredGroups = this.collectionGroups;
    } else {
      this.filteredGroups = this.collectionGroups
        .map(group => ({
          name: group.name,
          gaps: group.gaps.filter(g =>
            g.name.toLowerCase().includes(query) ||
            g.groupName.toLowerCase().includes(query)
          )
        }))
        .filter(group => group.gaps.length > 0);
    }
  }

  // -- Radarr (movies) / Sonarr (TV) --
  // One generic implementation; the per-integration differences (which service,
  // how a gap is added, eligibility, labels) live in the definition below.

  /** The downloader that applies to the current view (movies → Radarr, TV → Sonarr). */
  get activeDownloader(): Downloader {
    return this.mediaType === 'tv' ? 'sonarr' : 'radarr';
  }

  private downloaderDef(d: Downloader): DownloaderDef {
    if (d === 'sonarr') {
      return {
        label: 'Sonarr',
        addHint: 'Add this show to Sonarr',
        getConfig: () => this.sonarrService.getConfig(),
        ownedIds: () => this.sonarrService.getLibraryTvdbIds().pipe(
          map(res => res.tvdb_ids || []), catchError(() => of([] as number[]))),
        add: (gap: Gap) => this.sonarrService.addSeries(gap.id, gap.name),
        eligible: (gap: Gap) => gap.sonarrEligible,
      };
    }
    return {
      label: 'Radarr',
      addHint: 'Add this movie to Radarr',
      getConfig: () => this.radarrService.getConfig(),
      ownedIds: () => this.radarrService.getLibraryTmdbIds().pipe(
        map(res => res.tmdb_ids || []), catchError(() => of([] as number[]))),
      add: (gap: Gap) => this.radarrService.addMovie(gap.id, gap.name, parseInt(String(gap.year), 10) || 0),
      eligible: (gap: Gap) => gap.radarrEligible,
    };
  }

  refreshDownloaderStatus(d: Downloader): void {
    const def = this.downloaderDef(d);
    def.getConfig().pipe(catchError(() => of(null))).subscribe((cfg: any) => {
      const enabled = !!(cfg && cfg.enabled);
      this.downloaders[d].enabled = enabled;
      if (!enabled) return;
      def.ownedIds().subscribe(ids => {
        const status = this.downloaders[d].status;
        for (const id of ids) {
          if (status.get(id) !== 'sending') status.set(id, 'sent');
        }
      });
    });
  }

  sendToDownloader(gap: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    const d = this.activeDownloader;
    const def = this.downloaderDef(d);
    const state = this.downloaders[d];
    if (!gap.id || !state.enabled || !def.eligible(gap)) return;
    if (state.status.get(gap.id) === 'sending') return;
    state.status.set(gap.id, 'sending');
    state.errors.delete(gap.id);
    def.add(gap).subscribe({
      next: () => state.status.set(gap.id, 'sent'),
      error: (err: any) => {
        state.status.set(gap.id, 'error');
        state.errors.set(gap.id, err.error?.error || `Failed to add to ${def.label}`);
      },
    });
  }

  // -- Template helpers for the active downloader --

  get downloaderAddHint(): string {
    return this.downloaderDef(this.activeDownloader).addHint;
  }

  canSendToDownloader(gap: Gap): boolean {
    const d = this.activeDownloader;
    return this.downloaders[d].enabled
      && this.downloaderDef(d).eligible(gap)
      && !gap.owned
      && !this.isIgnored(gap);
  }

  downloaderStatusOf(id: number | undefined): SendState | undefined {
    return id ? this.downloaders[this.activeDownloader].status.get(id) : undefined;
  }

  downloaderErrorOf(id: number | undefined): string | undefined {
    return id ? this.downloaders[this.activeDownloader].errors.get(id) : undefined;
  }

  downloaderButtonLabel(id: number | undefined): string {
    const label = this.downloaderDef(this.activeDownloader).label;
    switch (this.downloaderStatusOf(id)) {
      case 'sending': return 'Sending...';
      case 'sent': return `In ${label}`;
      case 'error': return 'Retry';
      default: return `Send to ${label}`;
    }
  }

  downloaderButtonClass(id: number | undefined): string {
    switch (this.downloaderStatusOf(id)) {
      case 'sent': return 'btn-success';
      case 'error': return 'btn-outline-danger';
      default: return 'btn-outline-primary';
    }
  }
}
