import { Component, OnInit, OnDestroy } from '@angular/core';
import { PlexService } from '../../services/plex.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService, ScanProgress } from '../../services/recommendation.service';
import { Movie } from '../../models/movie.model';
import { CollectionGap } from '../../models/recommendation.model';
import { ActiveServerResponse, PlexLibrary } from '../../models/plex.model';

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
  searchFilter = '';

  get filteredMovies(): Movie[] {
    const query = this.movieFilter.trim().toLowerCase();
    if (!query) return this.movies;
    return this.movies.filter(m => m.name.toLowerCase().includes(query));
  }

  // All gaps from backend (always includes owned)
  allGaps: CollectionGap[] = [];
  // Filtered view
  collectionGroups: CollectionGroup[] = [];
  filteredGroups: CollectionGroup[] = [];
  selectedMovie: Movie | null = null;
  scanMode = false;

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
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
  ) {}

  ngOnInit(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res: ActiveServerResponse) => {
        if (res && res.server) {
          this.hasServer = true;
          this.libraries = Array.isArray(res.libraries)
            ? res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie')
            : [];
        }
        this.loading = false;
      },
      error: () => {
        this.hasServer = false;
        this.loading = false;
      }
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

    this.libraryService.getMovies(this.selectedLibrary).subscribe({
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

    this.recommendationService.startScan(this.selectedLibrary, true, freshScan).subscribe({
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
      true
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
    const filtered = this.showOwned
      ? this.allGaps
      : this.allGaps.filter(g => !g.owned);

    this.missingCount = this.allGaps.filter(g => !g.owned).length;

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
