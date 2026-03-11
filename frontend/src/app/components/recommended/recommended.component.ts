import { Component, OnInit, OnDestroy } from '@angular/core';
import { forkJoin } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { PlexService } from '../../services/plex.service';
import { JellyfinService } from '../../services/jellyfin.service';
import { EmbyService } from '../../services/emby.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService, ScanProgress } from '../../services/recommendation.service';
import { Movie } from '../../models/movie.model';
import { CollectionGap } from '../../models/recommendation.model';
import { ActiveServerResponse, PlexLibrary } from '../../models/plex.model';
import { PreferencesService } from '../../services/preferences.service';

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
  libraries: PlexLibrary[] = [];
  selectedLibrary = '';
  movies: Movie[] = [];
  movieFilter = '';
  showOwned = false;
  moviesPerPage = 50;
  currentPage = 1;
  searchFilter = '';

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
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
    private preferencesService: PreferencesService,
  ) {}

  ngOnInit(): void {
    this.recommendationService.getIgnored().pipe(
      catchError(() => of([]))
    ).subscribe(ids => this.ignoredIds = new Set(ids));

    this.preferencesService.load().pipe(
      catchError(() => of(null))
    ).subscribe((prefs) => {
      if (prefs) {
        this.moviesPerPage = prefs.moviesPerPage || 50;
        this.showOwned = !prefs.hideOwnedByDefault;
      }

      // Check all three media servers in parallel
      forkJoin({
        plex: this.plexService.getActiveServer().pipe(catchError(() => of(null))),
        jellyfin: this.jellyfinService.getActiveServer().pipe(catchError(() => of(null))),
        emby: this.embyService.getActiveServer().pipe(catchError(() => of(null))),
      }).subscribe((servers) => {
        let res: ActiveServerResponse | null = null;

        if (servers.plex && (servers.plex as any).server) {
          res = servers.plex as ActiveServerResponse;
          this.activeSource = 'plex';
        } else if (servers.jellyfin && (servers.jellyfin as any).server) {
          res = servers.jellyfin as ActiveServerResponse;
          this.activeSource = 'jellyfin';
        } else if (servers.emby && (servers.emby as any).server) {
          res = servers.emby as ActiveServerResponse;
          this.activeSource = 'emby';
        }

        if (res && res.server) {
          this.hasServer = true;
          this.activeServerName = res.server;
          this.libraries = Array.isArray(res.libraries)
            ? res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie')
            : [];

          if (prefs?.defaultLibrary && this.libraries.some(l => l.title === prefs.defaultLibrary)) {
            this.selectedLibrary = prefs.defaultLibrary;
            this.onLibrarySelect();
          }
        }
        this.loading = false;
      });
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  onLibrarySelect(): void {
    if (!this.selectedLibrary) return;
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
        this.movies = Array.isArray(res) ? res : (res.movies || []);
        this.loadingMovies = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load movies from library.';
        this.loadingMovies = false;
      }
    });
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

    this.recommendationService.startScan(this.selectedLibrary, true, freshScan, this.activeSource).subscribe({
      next: () => {
        this.startPolling();
      },
      error: (err) => {
        this.errorMessage = err.error?.error || 'Failed to start scan.';
        this.loadingGaps = false;
      }
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.recommendationService.getScanProgress().subscribe({
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
    }, 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  selectMovie(movie: Movie): void {
    this.selectedMovie = movie;
    this.scanMode = false;
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.errorMessage = '';

    // Always fetch with showExisting=true; backend uses fallback chain for ID resolution
    this.recommendationService.getGapsForMovie(
      movie,
      this.selectedLibrary,
      true,
      this.activeSource
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

  isIgnored(gap: CollectionGap): boolean {
    return this.ignoredIds.has(gap.tmdbId);
  }

  toggleIgnore(gap: CollectionGap, event: Event): void {
    event.stopPropagation();
    if (this.ignoredIds.has(gap.tmdbId)) {
      this.ignoredIds.delete(gap.tmdbId);
      this.recommendationService.removeIgnored(gap.tmdbId).subscribe();
    } else {
      this.ignoredIds.add(gap.tmdbId);
      this.recommendationService.addIgnored(gap.tmdbId).subscribe();
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
    this.recommendationService.addIgnoredBulk(idsToIgnore).subscribe();
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
    this.recommendationService.removeIgnoredBulk(idsToUnignore).subscribe();
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

  applyFilter(): void {
    let filtered = this.showOwned
      ? this.allGaps
      : this.allGaps.filter(g => !g.owned);

    if (!this.showIgnored) {
      filtered = filtered.filter(g => !this.ignoredIds.has(g.tmdbId));
    }

    this.missingCount = this.allGaps.filter(g => !g.owned && !this.ignoredIds.has(g.tmdbId)).length;

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
