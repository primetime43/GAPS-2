import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { forkJoin, of, Subject, Subscription, timer } from 'rxjs';
import { catchError, filter, skip, switchMap, takeUntil } from 'rxjs/operators';
import { PlexService } from '../../services/plex.service';
import { JellyfinService } from '../../services/jellyfin.service';
import { EmbyService } from '../../services/emby.service';
import { LibraryService } from '../../services/library.service';
import { TvdbService, TvdbGap, TvdbScanProgress } from '../../services/tvdb.service';
import { ActiveServerResponse, MediaLibrary } from '../../models/media-server.model';
import { Show } from '../../models/show.model';

interface FranchiseGroup {
  name: string;
  gaps: TvdbGap[];
}

@Component({
  selector: 'app-tv-recommended',
  templateUrl: './tv-recommended.component.html',
  styleUrls: ['./tv-recommended.component.scss'],
  standalone: false,
})
export class TvRecommendedComponent implements OnInit, OnDestroy {
  libraries: MediaLibrary[] = [];
  selectedLibrary = '';
  selectedLibraries: string[] = [];
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';
  hasServer = false;
  tvdbEnabled = false;

  loading = true;
  loadingShows = false;
  loadingGaps = false;
  scanning = false;
  errorMessage = '';

  // Single-show click-through lookup.
  selectedShow: Show | null = null;

  // Browse grid for the selected library (mirrors the movie picker).
  shows: Show[] = [];
  showFilter = '';
  showsPerPage = 50;
  currentPage = 1;

  showOwned = false;
  searchFilter = '';

  get filteredShows(): Show[] {
    const query = this.showFilter.trim().toLowerCase();
    return query ? this.shows.filter((s) => s.name.toLowerCase().includes(query)) : this.shows;
  }

  get pagedShows(): Show[] {
    const start = (this.currentPage - 1) * this.showsPerPage;
    return this.filteredShows.slice(start, start + this.showsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredShows.length / this.showsPerPage);
  }

  allGaps: TvdbGap[] = [];
  filteredGroups: FranchiseGroup[] = [];
  totalOwned = 0;
  missingCount = 0;

  scanProgress: TvdbScanProgress | null = null;
  showFreshScanConfirm = false;
  freshScanActive = false;

  private pollSub: Subscription | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
    private libraryService: LibraryService,
    private tvdb: TvdbService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.loadContext();

    // The route is reused (component instance kept alive across navigation),
    // so ngOnInit runs only once. Re-detect the server and TVDB config on every
    // return to this page so a server connected in Settings is picked up without
    // a full page reload.
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      filter((e) => e.urlAfterRedirects.split(/[?#]/)[0] === '/recommended'),
      skip(1),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadContext());
  }

  private loadContext(): void {
    this.tvdb.getConfig().pipe(catchError(() => of(null))).subscribe((cfg) => {
      this.tvdbEnabled = !!(cfg && cfg.enabled);
    });
    this.detectActiveServer();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private detectActiveServer(): void {
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
        // TV libraries are 'show' on Plex and 'tvshows' on Jellyfin/Emby.
        this.libraries = Array.isArray(res.libraries)
          ? res.libraries.filter((lib: MediaLibrary) => lib.type === 'show' || lib.type === 'tvshows')
          : [];
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
    // Keep the multi-select list in sync with the dropdown choice.
    if (!this.selectedLibraries.includes(this.selectedLibrary)) {
      this.selectedLibraries = [this.selectedLibrary];
    }
    // A new primary library invalidates any previously shown results.
    this.allGaps = [];
    this.filteredGroups = [];
    this.selectedShow = null;
    this.shows = [];
    this.showFilter = '';
    this.currentPage = 1;
    this.errorMessage = '';

    // Load the library's shows so the user can browse them (and so the backend
    // has them cached before a scan), mirroring the movie picker.
    this.loadingShows = true;
    this.libraryService.getShows(this.selectedLibrary, this.activeSource).subscribe({
      next: (res: any) => {
        this.shows = Array.isArray(res) ? res : (res.shows || []);
        this.loadingShows = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.error || 'Failed to load shows from library.';
        this.loadingShows = false;
      },
    });
  }

  onPageChange(delta: number): void {
    this.currentPage += delta;
  }

  selectShow(show: Show): void {
    if (!show.tvdbId) {
      this.errorMessage = `"${show.name}" has no TheTVDB ID, so its franchise can't be looked up.`;
      return;
    }
    this.selectedShow = show;
    this.loadingGaps = true;
    this.allGaps = [];
    this.filteredGroups = [];
    this.errorMessage = '';

    const libs = this.selectedLibraries.length
      ? this.selectedLibraries
      : (this.selectedLibrary ? [this.selectedLibrary] : []);

    this.tvdb.getGapsForShow(show.tvdbId, libs, true, this.activeSource).subscribe({
      next: (gaps) => {
        this.allGaps = gaps;
        // If the franchise is complete (all owned), show owned so it isn't empty.
        if (gaps.length > 0 && gaps.every((g) => g.owned)) {
          this.showOwned = true;
        }
        this.applyFilter();
        this.loadingGaps = false;
      },
      error: (err) => {
        this.errorMessage = err.error?.error || 'Failed to find franchise gaps.';
        this.loadingGaps = false;
      },
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

  scan(freshScan = false): void {
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
    const scanLibraries = this.selectedLibraries.length
      ? this.selectedLibraries
      : (this.selectedLibrary ? [this.selectedLibrary] : []);
    if (!scanLibraries.length) {
      this.errorMessage = 'Select a TV library to scan.';
      return;
    }
    this.freshScanActive = freshScan;
    this.scanning = true;
    this.errorMessage = '';
    this.allGaps = [];
    this.filteredGroups = [];
    this.selectedShow = null;
    this.scanProgress = null;

    this.tvdb.startScan({
      source: this.activeSource,
      libraryNames: scanLibraries,
      showExisting: true,
      freshScan,
    }).subscribe({
      next: () => this.startPolling(),
      error: (err) => {
        this.errorMessage = err.error?.error || 'Failed to start scan.';
        this.scanning = false;
      },
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollSub = timer(0, 1500).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.tvdb.getScanProgress()),
    ).subscribe({
      next: (progress) => {
        this.scanProgress = progress;
        if (progress.status === 'done') {
          this.stopPolling();
          this.allGaps = progress.gaps;
          this.totalOwned = progress.total_owned;
          this.applyFilter();
          this.scanning = false;
          this.scanProgress = null;
        } else if (progress.status === 'error') {
          this.stopPolling();
          this.errorMessage = progress.error || 'Scan failed.';
          this.scanning = false;
          this.scanProgress = null;
        } else if (progress.status === 'cancelled' || progress.status === 'idle') {
          this.stopPolling();
          this.scanning = false;
          this.scanProgress = null;
        }
      },
      error: () => {
        // Ignore transient polling errors.
      },
    });
  }

  stopScan(): void {
    this.tvdb.cancelScan().subscribe({ next: () => {}, error: () => {} });
    this.stopPolling();
    this.scanning = false;
    this.scanProgress = null;
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  onShowOwnedChange(): void {
    this.applyFilter();
  }

  applyFilter(): void {
    let filtered = this.showOwned ? this.allGaps : this.allGaps.filter((g) => !g.owned);

    this.missingCount = this.allGaps.filter((g) => !g.owned).length;

    const groups = new Map<string, TvdbGap[]>();
    for (const gap of filtered) {
      if (!groups.has(gap.franchiseName)) {
        groups.set(gap.franchiseName, []);
      }
      groups.get(gap.franchiseName)!.push(gap);
    }

    let collectionGroups: FranchiseGroup[] = Array.from(groups.entries())
      .map(([name, gaps]) => ({ name, gaps }));

    const query = this.searchFilter.trim().toLowerCase();
    if (query) {
      collectionGroups = collectionGroups
        .map((group) => ({
          name: group.name,
          gaps: group.gaps.filter(
            (g) =>
              g.name.toLowerCase().includes(query) ||
              g.franchiseName.toLowerCase().includes(query),
          ),
        }))
        .filter((group) => group.gaps.length > 0);
    }

    this.filteredGroups = collectionGroups;
  }

  clearResults(): void {
    this.allGaps = [];
    this.filteredGroups = [];
    this.selectedShow = null;
    this.searchFilter = '';
    this.errorMessage = '';
  }

  tvdbUrl(gap: TvdbGap): string {
    return gap.slug ? `https://thetvdb.com/series/${gap.slug}` : 'https://thetvdb.com';
  }

  get progressPercent(): number {
    if (!this.scanProgress || !this.scanProgress.total) return 0;
    return (this.scanProgress.processed / this.scanProgress.total) * 100;
  }
}
