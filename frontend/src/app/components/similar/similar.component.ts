import { Component, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ActiveServerService, MediaServerSource } from '../../services/active-server.service';
import { LibraryService } from '../../services/library.service';
import { PreferencesService } from '../../services/preferences.service';
import { RecommendationService } from '../../services/recommendation.service';
import { RadarrService } from '../../services/radarr.service';
import { MediaLibrary } from '../../models/media-server.model';
import { Movie } from '../../models/movie.model';
import { Gap } from '../../models/recommendation.model';

type ResultView = 'all' | 'owned' | 'missing';
type ResultSort = 'relevance' | 'rating' | 'year' | 'name';
type SendState = 'sending' | 'sent' | 'error';

@Component({
  selector: 'app-similar',
  templateUrl: './similar.component.html',
  styleUrls: ['./similar.component.scss'],
  standalone: false,
})
export class SimilarComponent implements OnInit {
  loading = true;
  loadingMovies = false;
  loadingSimilar = false;
  hasServer = false;
  activeSource: MediaServerSource = 'plex';
  activeServerName = '';

  libraries: MediaLibrary[] = [];
  selectedLibraries: string[] = [];
  movies: Movie[] = [];
  selectedMovie: Movie | null = null;
  movieFilter = '';
  currentPage = 1;
  itemsPerPage = 50;

  allSimilar: Gap[] = [];
  filteredSimilar: Gap[] = [];
  resultFilter = '';
  view: ResultView = 'all';
  sortBy: ResultSort = 'relevance';
  ownedCount = 0;
  missingCount = 0;
  errorMessage = '';

  radarrEnabled = false;
  private sendStatus = new Map<number, SendState>();
  private sendErrors = new Map<number, string>();

  constructor(
    private activeServerService: ActiveServerService,
    private libraryService: LibraryService,
    private preferencesService: PreferencesService,
    private recommendationService: RecommendationService,
    private radarrService: RadarrService,
  ) {}

  ngOnInit(): void {
    this.refreshRadarrStatus();
    forkJoin({
      active: this.activeServerService.getActive(),
      prefs: this.preferencesService.load().pipe(catchError(() => of(null))),
    }).subscribe(({ active, prefs }) => {
      if (!active) {
        this.loading = false;
        return;
      }

      this.hasServer = true;
      this.activeSource = active.source;
      this.activeServerName = active.server;
      this.libraries = active.libraries.filter(lib => lib.type === 'movie');
      this.itemsPerPage = prefs?.moviesPerPage || 50;

      if (this.libraries.length) {
        const preferred = prefs?.defaultLibrary;
        const initial = preferred && this.libraries.some(lib => lib.title === preferred)
          ? preferred
          : this.libraries[0].title;
        this.selectedLibraries = [initial];
        this.loadMovies();
      }
      this.loading = false;
    });
  }

  get filteredMovies(): Movie[] {
    const query = this.movieFilter.trim().toLowerCase();
    return query
      ? this.movies.filter(movie => movie.name.toLowerCase().includes(query))
      : this.movies;
  }

  get pagedMovies(): Movie[] {
    const start = (this.currentPage - 1) * this.itemsPerPage;
    return this.filteredMovies.slice(start, start + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMovies.length / this.itemsPerPage));
  }

  toggleLibrarySelection(title: string): void {
    const index = this.selectedLibraries.indexOf(title);
    if (index >= 0) {
      this.selectedLibraries.splice(index, 1);
    } else {
      this.selectedLibraries.push(title);
    }
    this.loadMovies();
  }

  isLibrarySelected(title: string): boolean {
    return this.selectedLibraries.includes(title);
  }

  loadMovies(): void {
    this.movies = [];
    this.selectedMovie = null;
    this.allSimilar = [];
    this.filteredSimilar = [];
    this.movieFilter = '';
    this.currentPage = 1;
    this.errorMessage = '';

    if (!this.selectedLibraries.length) {
      this.loadingMovies = false;
      return;
    }

    this.loadingMovies = true;
    forkJoin(
      this.selectedLibraries.map(title =>
        this.libraryService.getMovies(title, this.activeSource)
          .pipe(catchError(() => of({ movies: [] as Movie[] })))
      )
    ).subscribe(results => {
      const seen = new Set<number>();
      const merged: Movie[] = [];
      for (const result of results) {
        for (const movie of result.movies || []) {
          if (!movie.tmdbId || seen.has(movie.tmdbId)) continue;
          seen.add(movie.tmdbId);
          merged.push(movie);
        }
      }
      this.movies = merged.sort((a, b) => a.name.localeCompare(b.name));
      this.loadingMovies = false;
    });
  }

  selectMovie(movie: Movie): void {
    if (!movie.tmdbId) {
      this.errorMessage = '"' + movie.name + '" has no TMDB ID and cannot be used for a similar-movie lookup.';
      return;
    }

    this.selectedMovie = movie;
    this.loadingSimilar = true;
    this.allSimilar = [];
    this.filteredSimilar = [];
    this.resultFilter = '';
    this.errorMessage = '';

    this.recommendationService.getSimilarMovies(
      movie.tmdbId,
      this.selectedLibraries,
      this.activeSource,
    ).subscribe({
      next: rows => {
        this.allSimilar = (rows || []).map(row => ({
          id: row.tmdbId,
          tmdbId: row.tmdbId,
          name: row.name,
          year: row.year,
          releaseDate: row.releaseDate,
          posterUrl: row.posterUrl ?? null,
          overview: row.overview || '',
          groupName: 'Similar Movies',
          owned: !!row.owned,
          externalUrl: 'https://www.themoviedb.org/movie/' + row.tmdbId,
          radarrEligible: !!row.tmdbId,
          sonarrEligible: false,
          tmdbRating: row.voteAverage && row.voteAverage > 0 ? row.voteAverage : undefined,
          tmdbVotes: row.voteCount || undefined,
          genreIds: row.genreIds || [],
          popularity: row.popularity || 0,
        }));
        this.applyFilter();
        this.loadingSimilar = false;
      },
      error: err => {
        this.errorMessage = err.error?.error || 'Failed to load similar movies from TMDB.';
        this.loadingSimilar = false;
      },
    });
  }

  clearResults(): void {
    this.selectedMovie = null;
    this.allSimilar = [];
    this.filteredSimilar = [];
    this.resultFilter = '';
    this.errorMessage = '';
  }

  setView(view: ResultView): void {
    this.view = view;
    this.applyFilter();
  }

  applyFilter(): void {
    this.ownedCount = this.allSimilar.filter(movie => movie.owned).length;
    this.missingCount = this.allSimilar.length - this.ownedCount;

    let rows = [...this.allSimilar];
    if (this.view === 'owned') rows = rows.filter(movie => movie.owned);
    if (this.view === 'missing') rows = rows.filter(movie => !movie.owned);

    const query = this.resultFilter.trim().toLowerCase();
    if (query) rows = rows.filter(movie => movie.name.toLowerCase().includes(query));

    if (this.sortBy === 'rating') {
      rows.sort((a, b) => (b.tmdbRating || 0) - (a.tmdbRating || 0));
    } else if (this.sortBy === 'year') {
      rows.sort((a, b) => String(b.year).localeCompare(String(a.year)));
    } else if (this.sortBy === 'name') {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    }
    this.filteredSimilar = rows;
  }

  onPageChange(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }

  trackByMovie(_index: number, movie: Movie): number {
    return movie.tmdbId || 0;
  }

  trackByGap(_index: number, gap: Gap): number {
    return gap.id;
  }

  private refreshRadarrStatus(): void {
    this.radarrService.getConfig().pipe(catchError(() => of(null))).subscribe(config => {
      this.radarrEnabled = !!config?.enabled;
      if (!this.radarrEnabled) return;
      this.radarrService.getLibraryTmdbIds().pipe(
        map(response => response.tmdb_ids || []),
        catchError(() => of([] as number[])),
      ).subscribe(ids => {
        for (const id of ids) this.sendStatus.set(id, 'sent');
      });
    });
  }

  canSendToRadarr(movie: Gap): boolean {
    return this.radarrEnabled && movie.radarrEligible && !movie.owned;
  }

  sendToRadarr(movie: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.canSendToRadarr(movie) || this.sendStatus.get(movie.id) === 'sending') return;

    this.sendStatus.set(movie.id, 'sending');
    this.sendErrors.delete(movie.id);
    this.radarrService.addMovie(
      movie.id,
      movie.name,
      parseInt(String(movie.year), 10) || 0,
    ).subscribe({
      next: () => this.sendStatus.set(movie.id, 'sent'),
      error: err => {
        this.sendStatus.set(movie.id, 'error');
        this.sendErrors.set(movie.id, err.error?.error || 'Failed to add to Radarr');
      },
    });
  }

  radarrStatus(id: number): SendState | undefined {
    return this.sendStatus.get(id);
  }

  radarrError(id: number): string | undefined {
    return this.sendErrors.get(id);
  }

  radarrLabel(id: number): string {
    switch (this.radarrStatus(id)) {
      case 'sending': return 'Sending...';
      case 'sent': return 'In Radarr';
      case 'error': return 'Retry';
      default: return 'Send to Radarr';
    }
  }

  radarrButtonClass(id: number): string {
    switch (this.radarrStatus(id)) {
      case 'sent': return 'btn-success';
      case 'error': return 'btn-outline-danger';
      default: return 'btn-outline-primary';
    }
  }
}
