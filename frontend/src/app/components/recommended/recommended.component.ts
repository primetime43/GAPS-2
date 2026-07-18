import { Component, OnInit, OnDestroy, ViewChild, ElementRef, NgZone } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { forkJoin, Observable, Subject, Subscription, timer } from 'rxjs';
import { catchError, filter, map, skip, switchMap, takeUntil } from 'rxjs/operators';
import { of } from 'rxjs';
import { ActiveServerService } from '../../services/active-server.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TvdbService } from '../../services/tvdb.service';
import { Gap } from '../../models/recommendation.model';
import { MediaLibrary } from '../../models/media-server.model';
import { PreferencesService, MissingFilters } from '../../services/preferences.service';
import { ExportService, ExportFormat } from '../../services/export.service';
import { RadarrService } from '../../services/radarr.service';
import { SonarrService } from '../../services/sonarr.service';
import { GapViewService } from '../../services/gap-view.service';
import { ScanHistoryService } from '../../services/scan-history.service';
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
  // The libraries to browse + scan + count as owned (single source of truth).
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

  // Show IMDb/TMDB rating badges on cards, per provider (default from prefs,
  // live-toggleable from the Filters menu).
  showImdbRatings = false;
  showTmdbRatings = true;
  // IMDb ratings are pulled on demand (button), not auto-fetched — each title
  // needs its own TMDB->IMDb lookup, slow across a full result set.
  loadingImdbRatings = false;
  imdbRatingsLoaded = false;

  // Results sort + genre filter (reuse fields already on each gap).
  sortBy: 'default' | 'rating' | 'popularity' | 'year' | 'name' = 'default';
  genreFilter: number | null = null;
  // True once preferences have been loaded and applied; gates saveMissingFilters
  // so early/initial state changes don't clobber the persisted filters.
  private filtersLoaded = false;
  genres: TmdbGenre[] = [];
  availableGenres: TmdbGenre[] = [];

  // Memoized browse-item filter. `items` is only ever reassigned (never mutated
  // in place), so caching against its reference + the query lets us skip the
  // O(n) filter on every change-detection cycle, recomputing only when the item
  // set or filter text actually changes. pagedItems/totalPages stay getters —
  // once filteredItems is cached they're just a slice/count and cost nothing.
  private _filteredItemsRef: BrowseItem[] | null = null;
  private _filteredItemsQuery: string | null = null;
  private _filteredItemsCache: BrowseItem[] = [];

  get filteredItems(): BrowseItem[] {
    const query = this.itemFilter.trim().toLowerCase();
    if (this.items !== this._filteredItemsRef || query !== this._filteredItemsQuery) {
      this._filteredItemsRef = this.items;
      this._filteredItemsQuery = query;
      this._filteredItemsCache = query
        ? this.items.filter(m => m.name.toLowerCase().includes(query))
        : this.items;
    }
    return this._filteredItemsCache;
  }

  get pagedItems(): BrowseItem[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredItems.slice(start, start + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredItems.length / this.itemsPerPage);
  }

  // trackBy helpers so large *ngFor lists reuse DOM nodes instead of re-creating
  // every card each change-detection cycle.
  trackByBrowseItem(_index: number, item: BrowseItem): string | number {
    return item.tmdbId ?? `${item.name}|${item.year}`;
  }

  trackByGroupName(_index: number, group: GapGroup): string {
    return group.name;
  }

  trackByGapId(_index: number, gap: Gap): number {
    return gap.id;
  }

  // Memoized windowed view of filteredGroups capped at renderLimit cards.
  // filteredGroups is only ever reassigned, so a reference + limit check lets us
  // skip recomputing the window every change-detection cycle.
  private _visibleRef: GapGroup[] | null = null;
  private _visibleLimit = -1;
  private _visibleGroups: GapGroup[] = [];
  private _hasMore = false;

  get visibleGroups(): GapGroup[] {
    if (this.filteredGroups !== this._visibleRef || this.renderLimit !== this._visibleLimit) {
      this._visibleRef = this.filteredGroups;
      this._visibleLimit = this.renderLimit;
      const out: GapGroup[] = [];
      let shown = 0;
      let total = 0;
      for (const group of this.filteredGroups) total += group.gaps.length;
      for (const group of this.filteredGroups) {
        if (shown >= this.renderLimit) break;
        const room = this.renderLimit - shown;
        if (group.gaps.length <= room) {
          out.push(group);
          shown += group.gaps.length;
        } else {
          // Partially render this group; trackByGroupName keeps the DOM node so
          // growing the window just appends cards to it.
          out.push({ ...group, gaps: group.gaps.slice(0, room) });
          shown += room;
        }
      }
      this._visibleGroups = out;
      this._hasMore = shown < total;
    }
    return this._visibleGroups;
  }

  get hasMoreToRender(): boolean {
    this.visibleGroups;  // ensure the window (and _hasMore) is current
    return this._hasMore;
  }

  /** Reveal the next chunk of gap cards. */
  loadMore(): void {
    this.renderLimit += this.RENDER_CHUNK;
  }

  // Auto-load the next chunk as the sentinel (rendered only while more remains)
  // scrolls near the viewport. The observer fires outside Angular, so hop back
  // into the zone to trigger change detection.
  @ViewChild('renderSentinel') set renderSentinel(el: ElementRef<HTMLElement> | undefined) {
    this.renderObserver?.disconnect();
    if (!el) return;
    this.renderObserver = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          this.zone.run(() => this.loadMore());
        }
      },
      { rootMargin: '600px' },
    );
    this.renderObserver.observe(el.nativeElement);
  }

  // All gaps from backend (normalized; always includes owned)
  allGaps: Gap[] = [];
  collectionGroups: GapGroup[] = [];
  filteredGroups: GapGroup[] = [];
  // Progressive rendering: only this many gap cards are in the DOM at once,
  // grown on scroll (IntersectionObserver) or via the "Show more" button, so a
  // large result set doesn't render thousands of nodes up front. Reset on every
  // applyFilter (new scan / filter change).
  private readonly RENDER_CHUNK = 60;
  renderLimit = this.RENDER_CHUNK;
  private renderObserver?: IntersectionObserver;
  // Ignored items (TMDB ids for movies, TheTVDB ids for shows — reloaded on toggle)
  ignoredIds: Set<number> = new Set();
  pendingIgnoreGap: Gap | null = null;
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
  incrementalActive = false;
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

  // Reopening a saved scan (from the Scan History page): the id to load once the
  // server context is ready, and the banner info shown while viewing it.
  private pendingSavedScanId: string | null = null;
  savedScanInfo: { timestamp: string; libraries: string[] } | null = null;

  constructor(
    private activeServerService: ActiveServerService,
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
    private tvdb: TvdbService,
    private preferencesService: PreferencesService,
    private exportService: ExportService,
    private radarrService: RadarrService,
    private sonarrService: SonarrService,
    private gapView: GapViewService,
    private tmdbService: TmdbService,
    private scanHistoryService: ScanHistoryService,
    private router: Router,
    private zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.tmdbService.getGenres().pipe(catchError(() => of([] as TmdbGenre[]))).subscribe(g => {
      this.genres = g;
      this.availableGenres = this.gapView.availableGenres(this.allGaps, this.genres);
    });
    this.captureSavedScanParam();
    this.loadContext(true);

    // This route is reused (ReusableRouteStrategy), so navigating back into
    // /recommended?scan=<id> doesn't re-run ngOnInit — re-read the param here too.
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      filter(e => e.urlAfterRedirects.split(/[?#]/)[0] === '/recommended'),
      skip(1),
      takeUntil(this.destroy$),
    ).subscribe(() => {
      this.captureSavedScanParam();
      this.loadContext(false);
    });
  }

  /** Stash a `?scan=<id>&type=<movie|tv>` request to reopen a saved scan once the
   * server context is ready (see finishInitialization). Read from the live URL so
   * it works whether or not the route component was reused. */
  private captureSavedScanParam(): void {
    const qp = this.router.parseUrl(this.router.url).queryParams || {};
    const scanId = qp['scan'];
    if (!scanId) return;
    this.pendingSavedScanId = scanId;
    const type = qp['type'];
    if (type === 'tv' || type === 'movie') this.mediaType = type;
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.renderObserver?.disconnect();
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
    this.savedScanInfo = null;
    this.stopPolling();
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
    // Keep the remembered filters in step with the cleared genre.
    this.saveMissingFilters();
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
        this.showImdbRatings = !!prefs.showImdbRatings;
        this.showTmdbRatings = prefs.showTmdbRatings !== false;
        // Remembered Missing-view filters override the seeded defaults above.
        const mf = prefs.missingFilters;
        if (mf) {
          if (mf.view) this.view = mf.view;
          if (mf.sortBy) this.sortBy = mf.sortBy;
          this.genreFilter = mf.genreFilter ?? null;
          if (typeof mf.showFuture === 'boolean') this.showFuture = mf.showFuture;
        }
      }
      // Enable persistence only after the initial state is applied, so the
      // assignments above don't trigger a save that overwrites the saved value.
      this.filtersLoaded = true;
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
    // A saved scan was requested (Scan History → Missing view). Load it instead
    // of the normal last-scan restore, regardless of autoSelectLibrary.
    if (this.pendingSavedScanId) {
      const id = this.pendingSavedScanId;
      this.pendingSavedScanId = null;
      this.loadSavedScan(id);
      this.loading = false;
      return;
    }

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
        this.selectedLibraries = scanLibs.filter((l: string) => this.libraries.some(x => x.title === l));
        this.loadItems();
      } else {
        this.applyDefaultLibrary(prefs);
      }

      if (validScan) {
        this.allGaps = this.normalizeGaps(progress!.gaps);
        this.totalOwned = progress!.total_owned;
        this.scanMode = true;
        this.applyFilter();
        this.imdbRatingsLoaded = false;  // new result set → offer on-demand load again
        this.cacheCompletedScan(scanLibs, this.allGaps, progress!.total_owned);
      }
      this.loading = false;
    });
  }

  private applyDefaultLibrary(prefs: any): void {
    if (prefs?.defaultLibrary && this.libraries.some(l => l.title === prefs.defaultLibrary)) {
      this.selectedLibraries = [prefs.defaultLibrary];
      this.loadItems();
    }
  }

  /**
   * Reopen a saved scan (from Scan History) in the results view, like a manual
   * scan. The backend rehydrates the stored gaps with posters/ratings from cache
   * and returns them in the live-scan shape, so normalizeGaps/applyFilter render
   * them through the same path. Note the saved set is missing-only (owned titles
   * aren't stored), so the Owned toggle reads 0.
   */
  private loadSavedScan(id: string): void {
    this.scanMode = true;
    this.selectedItem = null;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.errorMessage = '';

    this.scanHistoryService.getGaps(id).subscribe({
      next: (resp) => {
        if ((resp.mediaType === 'tv' || resp.mediaType === 'movie') && resp.mediaType !== this.mediaType) {
          this.mediaType = resp.mediaType;
          this.applyLibraryFilter();
          this.loadIgnored();
        }
        // Reflect the scan's libraries in the toolbar (browse list stays empty
        // until a library is (re)selected — this is a read-only view of results).
        this.selectedLibraries = (resp.libraries || []).filter(
          l => this.libraries.some(x => x.title === l),
        );
        this.savedScanInfo = { timestamp: resp.timestamp, libraries: resp.libraries || [] };
        this.allGaps = this.normalizeGaps(resp.gaps || []);
        this.totalOwned = resp.totalOwned || 0;
        this.imdbRatingsLoaded = false;
        this.applyFilter();
        this.loadingGaps = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.error || 'Failed to load this saved scan.';
        this.loadingGaps = false;
        this.scanMode = false;
        this.savedScanInfo = null;
      },
    });
  }

  // -- Library selection / browse --

  /** Load the browse list for the selected libraries, merged and de-duplicated. */
  loadItems(): void {
    this.items = [];
    this.itemFilter = '';
    this.allGaps = [];
    this.collectionGroups = [];
    this.selectedItem = null;
    this.scanMode = false;
    this.savedScanInfo = null;
    this.errorMessage = '';
    this.currentPage = 1;

    if (!this.selectedLibraries.length) {
      this.loadingItems = false;
      return;
    }

    this.tryRestoreScanForCurrentSelection();

    this.loadingItems = !this.scanMode;
    const loads = this.selectedLibraries.map(lib => this.mediaType === 'tv'
      ? this.libraryService.getShows(lib, this.activeSource)
      : this.libraryService.getMovies(lib, this.activeSource));
    forkJoin(loads).subscribe({
      next: (results: any[]) => {
        const merged: BrowseItem[] = [];
        for (const res of results) {
          if (res?.error) continue;
          const arr = Array.isArray(res) ? res : (res.movies || res.shows || []);
          merged.push(...arr);
        }
        this.items = this.dedupeItems(merged);
        this.loadingItems = false;
        this.prefetchNextPage();
      },
      error: (err) => {
        this.errorMessage = this.friendlyError(err.error?.error || 'Failed to load library.');
        this.loadingItems = false;
      }
    });
  }

  /** De-duplicate browse items that appear in more than one selected library. */
  private dedupeItems(items: BrowseItem[]): BrowseItem[] {
    const seen = new Set<string>();
    const out: BrowseItem[] = [];
    for (const it of items) {
      const key = it.tmdbId ? `t:${it.tmdbId}`
        : it.tvdbId ? `v:${it.tvdbId}`
        : `n:${(it.name || '').toLowerCase()}|${it.year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
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
    this.imdbRatingsLoaded = false;  // new result set → offer on-demand load again
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
    // The browse list, scan set, and ownership all follow the selection.
    this.loadItems();
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

  /** Quick update: only look up movies added since the last scan (movies only).
   * Falls back to a full scan server-side if there's no compatible prior scan. */
  updateScan(): void {
    this.startScan(false, true);
  }

  onFreshScanConfirm(): void {
    this.showFreshScanConfirm = false;
    this.startScan(true);
  }

  onFreshScanCancel(): void {
    this.showFreshScanConfirm = false;
  }

  private startScan(freshScan: boolean, incremental = false): void {
    this.freshScanActive = freshScan;
    this.incrementalActive = incremental;
    this.scanMode = true;
    this.savedScanInfo = null;
    this.selectedItem = null;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.scanProgress = null;
    this.errorMessage = '';

    const scanLibraries = [...this.selectedLibraries];

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
          this.recommendationService.startScan(scanLibraries, true, freshScan, this.activeSource, incremental).subscribe({
            next: (res) => {
              // The server runs a full scan if there's no compatible prior scan
              // to update from — keep the notice honest about what actually ran.
              this.incrementalActive = res.mode === 'incremental';
              this.startPolling(scanLibraries);
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
            this.imdbRatingsLoaded = false;  // new result set → offer on-demand load again
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
    this.savedScanInfo = null;
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
      const libs = [...this.selectedLibraries];
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

    // Owned set = the libraries selected in the toolbar plus any extra the user
    // ticked in this single-movie view.
    const owned = [...new Set([...this.selectedLibraries, ...this.crossCheckLibraries])];
    this.recommendationService.getGapsForMovie(
      this.selectedItem as any,
      owned[0] || '',
      true,
      this.activeSource,
      owned.slice(1)
    ).subscribe({
      next: (gaps) => {
        this.allGaps = this.normalizeGaps(gaps);
        if (this.allGaps.length > 0 && this.allGaps.every(g => g.owned)) this.view = 'all';
        this.applyFilter();
        this.imdbRatingsLoaded = false;  // new result set → offer on-demand load again
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
   * On-demand fetch of IMDb ratings for the current movie gaps (triggered by the
   * "Load IMDb ratings" button). Not called automatically — resolving each title's
   * IMDb id is a per-movie TMDB lookup, slow across a large result set.
   */
  loadImdbRatings(): void {
    if (this.mediaType !== 'movie' || !this.showImdbRatings) return;
    this.loadingImdbRatings = true;
    this.gapView.applyImdbRatings(this.allGaps).subscribe(() => {
      this.loadingImdbRatings = false;
      this.imdbRatingsLoaded = true;
      this.applyFilter();  // reflect new ratings when sorting by rating
    });
  }

  // -- Filters --

  onFilterChange(): void {
    this.applyFilter();
    this.saveMissingFilters();
  }

  /** Sort/genre dropdown change: re-filter and remember the choice. */
  onResultFilterChange(): void {
    this.applyFilter();
    this.saveMissingFilters();
  }

  /** Persist the Missing-view display filters so they survive a refresh. Stored
   * separately from the hideOwned/hideFuture scan defaults (see MissingFilters).
   * Fire-and-forget; no-op until preferences have finished loading. */
  private saveMissingFilters(): void {
    if (!this.filtersLoaded) return;
    const missingFilters: MissingFilters = {
      view: this.view,
      sortBy: this.sortBy,
      genreFilter: this.genreFilter,
      showFuture: this.showFuture,
    };
    this.preferencesService.save({ missingFilters }).subscribe({ next: () => {}, error: () => {} });
  }

  /** Persist the per-provider rating toggles so they stick as the new default. */
  onRatingPrefsChange(): void {
    this.preferencesService.save({
      showImdbRatings: this.showImdbRatings,
      showTmdbRatings: this.showTmdbRatings,
    }).subscribe({ next: () => {}, error: () => {} });
    // No auto-fetch — the "Load IMDb ratings" button pulls them on demand.
  }

  setView(view: 'all' | 'owned' | 'missing'): void {
    this.view = view;
    this.applyFilter();
    this.saveMissingFilters();
  }

  /** Display name of the active genre filter, or null when none is set. */
  get activeGenreName(): string | null {
    if (this.genreFilter == null) return null;
    return this.genres.find(g => g.id === this.genreFilter)?.name ?? null;
  }

  /** Clear the genre filter (from the results-page badge) and persist it. */
  clearGenreFilter(): void {
    this.genreFilter = null;
    this.applyFilter();
    this.saveMissingFilters();
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
    // No exact date (e.g. a reopened saved scan whose gaps were stripped of the
    // release date): fall back to the year, the same for movies and TV. An
    // unparseable year counts as released so the title isn't hidden by default.
    const year = parseInt(String(gap.year), 10);
    return year ? year > new Date().getFullYear() : false;
  }

  isIgnored(gap: Gap): boolean {
    return this.ignoredIds.has(gap.id);
  }

  get ignoreConfirmationMessage(): string {
    return this.pendingIgnoreGap
      ? `Are you sure you want to ignore "${this.pendingIgnoreGap.name}"?`
      : '';
  }

  toggleIgnore(gap: Gap, event: Event): void {
    event.stopPropagation();
    if (this.ignoredIds.has(gap.id)) {
      this.ignoredIds.delete(gap.id);
      this.ignoreRemove(gap.id).subscribe({ error: () => this.ignoredIds.add(gap.id) });
      this.applyFilter();
      return;
    }

    this.pendingIgnoreGap = gap;
  }

  onIgnoreConfirm(): void {
    const gap = this.pendingIgnoreGap;
    this.pendingIgnoreGap = null;
    if (!gap || this.ignoredIds.has(gap.id)) return;

    this.ignoredIds.add(gap.id);
    this.ignoreAdd(gap.id).subscribe({ error: () => this.ignoredIds.delete(gap.id) });
    this.applyFilter();
  }

  onIgnoreCancel(): void {
    this.pendingIgnoreGap = null;
  }

  // The template renders windowed groups (progressive rendering), so the group
  // handed to a per-group action may hold only the visible slice of cards. These
  // resolve the full group by name so "Ignore All" etc. act on the whole group.
  private groupByName = new Map<string, GapGroup>();
  private fullGroupOf(group: GapGroup): GapGroup {
    return this.groupByName.get(group.name) ?? group;
  }

  ignoreCollection(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = this.fullGroupOf(group).gaps.filter(g => !g.owned && !this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.add(id);
    this.ignoreAddBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.delete(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  unignoreCollection(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = this.fullGroupOf(group).gaps.filter(g => this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.delete(id);
    this.ignoreRemoveBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.add(id); this.applyFilter(); }
    });
    this.applyFilter();
  }

  collectionHasUnignoredGaps(group: GapGroup): boolean {
    return this.fullGroupOf(group).gaps.some(g => !g.owned && !this.ignoredIds.has(g.id));
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
    this.savedScanInfo = null;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.searchFilter = '';
    this.errorMessage = '';
  }

  exportResults(format: ExportFormat): void {
    const gaps = this.filteredGroups.flatMap(g => g.gaps);
    this.exportService.exportGaps(gaps, format).catch(() => {});
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

    // Counts respect the genre filter so the headline / view-toggle badges match
    // what's actually shown — otherwise an active genre silently hides results
    // while "Missing (N)" still reports the unfiltered total.
    const matchesGenre = (g: Gap) =>
      this.genreFilter == null || (g.genreIds || []).includes(this.genreFilter as number);

    this.ownedCount = this.allGaps.filter(g => g.owned && matchesGenre(g)).length;
    this.missingCount = this.allGaps.filter(g =>
      !g.owned
      && !this.ignoredIds.has(g.id)
      && (this.showFuture || !this.isFutureRelease(g))
      && matchesGenre(g)
    ).length;

    if (this.genreFilter != null) {
      filtered = filtered.filter(matchesGenre);
    }
    filtered = this.gapView.sortGaps(filtered, this.sortBy);

    const groups = new Map<string, Gap[]>();
    for (const gap of filtered) {
      if (!groups.has(gap.groupName)) groups.set(gap.groupName, []);
      groups.get(gap.groupName)!.push(gap);
    }
    this.collectionGroups = Array.from(groups.entries()).map(([name, gaps]) => ({ name, gaps }));
    this.availableGenres = this.gapView.availableGenres(this.allGaps, this.genres);

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
    // Index full groups by name for per-group actions (windowed rendering may
    // hand a partial group to the template), and reset the render window.
    this.groupByName = new Map(this.filteredGroups.map(g => [g.name, g]));
    this.renderLimit = this.RENDER_CHUNK;
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
