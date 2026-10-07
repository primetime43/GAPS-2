import { Component, OnInit, OnDestroy } from '@angular/core';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, map, takeUntil } from 'rxjs/operators';
import { ActiveServerService, MediaServerSource } from '../../services/active-server.service';
import { LibraryService } from '../../services/library.service';
import { PreferencesService } from '../../services/preferences.service';
import { RecommendationService } from '../../services/recommendation.service';
import { SonarrService } from '../../services/sonarr.service';
import { Show } from '../../models/show.model';
import { RadarrService } from '../../services/radarr.service';
import { GapViewService, RatingSource, SortDirection } from '../../services/gap-view.service';
import { ImdbRatingsLoader } from '../../services/imdb-ratings-loader';
import { MediaLibrary } from '../../models/media-server.model';
import { Movie } from '../../models/movie.model';
import { Gap } from '../../models/recommendation.model';
import { environment } from '../../../environments/environment';

type Seed = Movie | Show;
type ResultView = 'all' | 'owned' | 'missing';
type ResultSort = 'relevance' | 'rating' | 'votes' | 'year' | 'name';
type SendState = 'sending' | 'sent' | 'error';

@Component({
  selector: 'app-similar',
  templateUrl: './similar.component.html',
  styleUrls: ['./similar.component.scss'],
  standalone: false,
})
export class SimilarComponent implements OnInit, OnDestroy {
  private static readonly LIBRARY_SELECTIONS_KEY = 'gaps2.similar.librarySelections';

  loading = true;
  loadingMovies = false;
  loadingSimilar = false;
  hasServer = false;
  activeSource: MediaServerSource = 'plex';
  activeServerName = '';
  radarrRootFolderPath = '';
  radarrLibraries: string[] = [];

  mediaType: 'movie' | 'tv' = 'movie';
  private allLibraries: MediaLibrary[] = [];
  private defaultLibrary = '';
  sonarrRootFolderPath = '';
  sonarrEnabled = false;
  private sonarrStates = new Map<number, SendState>();
  private sonarrErrors = new Map<number, string>();
  libraries: MediaLibrary[] = [];
  selectedLibraries: string[] = [];
  movies: Seed[] = [];
  selectedMovie: Seed | null = null;
  movieFilter = '';
  currentPage = 1;
  itemsPerPage = 50;

  allSimilar: Gap[] = [];
  filteredSimilar: Gap[] = [];
  resultFilter = '';
  view: ResultView = 'all';
  sortBy: ResultSort = 'relevance';
  sortDirection?: SortDirection;
  readonly sortOptions = [
    { value: 'relevance', label: 'TMDB relevance' },
    { value: 'rating', label: 'Rating' },
    { value: 'votes', label: 'Vote count' },
    { value: 'year', label: 'Year' },
    { value: 'name', label: 'Title' },
  ];
  ownedCount = 0;
  missingCount = 0;
  errorMessage = '';

  // Load IMDb in the background only when the user enables its ratings.
  ratingSource: RatingSource = 'tmdb';
  showImdbRatings = false;
  showTmdbRatings = true;
  readonly imdbRatings = new ImdbRatingsLoader(this.gapView);
  minRating = 0;
  minVoteCount = 0;

  radarrEnabled = false;
  private sendStatus = new Map<number, SendState>();
  private sendErrors = new Map<number, string>();
  private destroy$ = new Subject<void>();
  private librariesChanged$ = new Subject<void>();
  private resultsChanged$ = new Subject<void>();
  externalLinkProvider: 'tmdb' | 'imdb' = 'tmdb';

  constructor(
    private activeServerService: ActiveServerService,
    private libraryService: LibraryService,
    private preferencesService: PreferencesService,
    private recommendationService: RecommendationService,
    private radarrService: RadarrService,
    private gapView: GapViewService,
    private sonarrService: SonarrService,
  ) {}

  ngOnInit(): void {
    this.refreshRadarrStatus();
    this.refreshSonarrStatus();
    forkJoin({
      active: this.activeServerService.getActive(),
      prefs: this.preferencesService.load().pipe(catchError(() => of(null))),
    }).pipe(takeUntil(this.destroy$)).subscribe(({ active, prefs }) => {
      if (!active) {
        this.loading = false;
        return;
      }

      this.hasServer = true;
      this.activeSource = active.source;
      this.activeServerName = active.server;
      this.allLibraries = active.libraries;
      this.defaultLibrary = prefs?.defaultLibrary || '';
      this.libraries = active.libraries.filter(lib => ['movie', 'movies'].includes(lib.type));
      this.itemsPerPage = prefs?.moviesPerPage || 50;
      this.showImdbRatings = !!prefs?.showImdbRatings;
      this.showTmdbRatings = prefs?.showTmdbRatings !== false;
      this.ratingSource = prefs?.ratingSource === 'imdb' ? 'imdb' : 'tmdb';
      this.externalLinkProvider = prefs?.externalLinkProvider || 'tmdb';
      if (prefs?.qualityFilterEnabled) {
        this.minRating = prefs.minRating || 0;
        this.minVoteCount = prefs.minVoteCount || 0;
      }

      if (this.libraries.length) {
        this.restoreLibrarySelection(prefs?.defaultLibrary);
        this.loadMovies();
      }
      this.loading = false;
    });
  }

  ngOnDestroy(): void {
    this.imdbRatings.reset();
    this.destroy$.next();
    this.destroy$.complete();
  }

  get effectiveRatingSource(): RatingSource { return this.mediaType === 'tv' ? 'imdb' : this.ratingSource; }
  get effectiveLinkProvider(): 'tmdb' | 'imdb' { return this.mediaType === 'tv' ? 'imdb' : this.externalLinkProvider; }
  readonly tvLinkOptions = [{ value: 'imdb', label: 'IMDb' }];
  readonly movieLinkOptions = [{ value: 'tmdb', label: 'TMDB' }, { value: 'imdb', label: 'IMDb' }];

  get mediaLabel(): string { return this.mediaType === 'tv' ? 'TV shows' : 'movies'; }
  get seedLabel(): string { return this.mediaType === 'tv' ? 'TV show' : 'movie'; }

  setMediaType(type: 'movie' | 'tv'): void {
    if (type === this.mediaType) return;
    this.saveLibrarySelection();
    this.mediaType = type;
    const types = type === 'tv' ? ['show', 'tvshows'] : ['movie', 'movies'];
    this.libraries = this.allLibraries.filter(lib => types.includes(lib.type));
    this.selectedLibraries = [];
    if (this.libraries.length) this.restoreLibrarySelection(this.defaultLibrary);
    this.loadMovies();
  }

  get filteredMovies(): Seed[] {
    const query = this.movieFilter.trim().toLowerCase();
    return query
      ? this.movies.filter(movie => movie.name.toLowerCase().includes(query))
      : this.movies;
  }

  get pagedMovies(): Seed[] {
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
    this.saveLibrarySelection();
    this.loadMovies();
  }

  isLibrarySelected(title: string): boolean {
    return this.selectedLibraries.includes(title);
  }

  private restoreLibrarySelection(defaultLibrary?: string): void {
    const selections = this.loadLibrarySelections();
    const saved = selections[this.librarySelectionContext()];
    if (Array.isArray(saved)) {
      const available = new Set(this.libraries.map(library => library.title));
      const valid = saved.filter((title, index) =>
        typeof title === 'string' && available.has(title) && saved.indexOf(title) === index
      );
      if (valid.length || saved.length === 0) {
        this.selectedLibraries = valid;
        return;
      }
    }

    const initial = defaultLibrary && this.libraries.some(lib => lib.title === defaultLibrary)
      ? defaultLibrary
      : this.libraries[0].title;
    this.selectedLibraries = [initial];
  }

  private saveLibrarySelection(): void {
    try {
      const selections = this.loadLibrarySelections();
      selections[this.librarySelectionContext()] = [...this.selectedLibraries];
      localStorage.setItem(
        SimilarComponent.LIBRARY_SELECTIONS_KEY,
        JSON.stringify(selections),
      );
    } catch {
      // Selection persistence is non-critical when browser storage is unavailable.
    }
  }

  private loadLibrarySelections(): Record<string, string[]> {
    try {
      const raw = localStorage.getItem(SimilarComponent.LIBRARY_SELECTIONS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private librarySelectionContext(): string {
    return `${this.activeSource}:${this.activeServerName}${this.mediaType === 'tv' ? ':tv' : ''}`;
  }

  loadMovies(): void {
    this.librariesChanged$.next();
    this.clearResults();
    this.movies = [];
    this.movieFilter = '';
    this.currentPage = 1;

    if (!this.selectedLibraries.length) {
      this.loadingMovies = false;
      return;
    }

    this.loadingMovies = true;
    forkJoin(
      this.selectedLibraries.map(title =>
        this.mediaType === 'tv'
          ? this.libraryService.getShows(title, this.activeSource).pipe(map(result => result.shows as Seed[]))
          : this.libraryService.getMovies(title, this.activeSource).pipe(map(result => result.movies as Seed[]))
      )
    ).pipe(takeUntil(this.librariesChanged$), takeUntil(this.destroy$)).subscribe({
      next: results => {
        const seen = new Set<string>();
        const merged: Seed[] = [];
        for (const result of results) {
          for (const movie of result || []) {
            const key = this.seedKey(movie);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(movie);
          }
        }
        this.movies = merged.sort((a, b) => a.name.localeCompare(b.name));
        this.loadingMovies = false;
      },
      error: err => {
        this.loadingMovies = false;
        this.errorMessage = err.error?.error || 'Failed to load selected libraries.';
      },
    });
  }

  selectMovie(movie: Seed): void {
    if (!this.seedKey(movie)) {
      const requiredId = this.mediaType === 'tv' ? 'TMDB, TVDB, or IMDb ID' : 'TMDB ID';
      this.errorMessage = `"${movie.name}" has no ${requiredId} for a recommendation lookup.`;
      return;
    }

    this.resultsChanged$.next();
    this.selectedMovie = movie;
    this.radarrLibraries = [...this.selectedLibraries];
    this.radarrRootFolderPath = '';
    this.sonarrRootFolderPath = '';
    this.loadingSimilar = true;
    this.allSimilar = [];
    this.filteredSimilar = [];
    this.resultFilter = '';
    this.errorMessage = '';
    this.imdbRatings.reset();
    this.ownedCount = 0;
    this.missingCount = 0;

    const request$ = this.mediaType === 'tv'
      ? this.recommendationService.getSimilarShows({ ...movie, tvdbId: Number(movie.tvdbId) || undefined }, this.selectedLibraries, this.activeSource)
      : this.recommendationService.getSimilarMovies(movie.tmdbId!, this.selectedLibraries, this.activeSource);
    request$.pipe(takeUntil(this.resultsChanged$), takeUntil(this.destroy$)).subscribe({
      next: rows => {
        this.allSimilar = (rows || []).map(row => ({
          id: row.tmdbId,
          tmdbId: row.tmdbId,
          tvdbId: row.tvdbId,
          imdbId: row.imdbId,
          name: row.name,
          year: row.year,
          releaseDate: row.releaseDate,
          posterUrl: row.posterUrl ?? null,
          overview: row.overview || '',
          groupName: this.mediaType === 'tv' ? 'Similar TV Shows' : 'Similar Movies',
          owned: !!row.owned,
          externalUrl: this.movieUrl(row.tmdbId, this.effectiveLinkProvider, row.imdbId),
          radarrEligible: this.mediaType === 'movie' && !!row.tmdbId,
          sonarrEligible: this.mediaType === 'tv' && !!row.tvdbId,
          tmdbRating: row.voteAverage && row.voteAverage > 0 ? row.voteAverage : undefined,
          tmdbVotes: row.voteCount || undefined,
          genreIds: row.genreIds || [],
          popularity: row.popularity || 0,
        }));
        this.applyFilter();
        this.loadingSimilar = false;
        this.loadImdbRatings();
      },
      error: err => {
        this.errorMessage = err.error?.error || `Failed to load similar ${this.mediaLabel} from TMDB.`;
        this.loadingSimilar = false;
      },
    });
  }

  clearResults(): void {
    this.resultsChanged$.next();
    this.loadingSimilar = false;
    this.selectedMovie = null;
    this.radarrRootFolderPath = '';
    this.sonarrRootFolderPath = '';
    this.radarrLibraries = [];
    this.allSimilar = [];
    this.filteredSimilar = [];
    this.resultFilter = '';
    this.errorMessage = '';
    this.imdbRatings.reset();
    this.ownedCount = 0;
    this.missingCount = 0;
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

    // Ratings and votes use the explicitly selected source, independently of badges.
    if (this.minRating > 0) {
      rows = rows.filter(movie => this.ratingOf(movie) >= this.minRating);
    }
    if (this.minVoteCount > 0) {
      rows = rows.filter(movie => this.votesOf(movie) >= this.minVoteCount);
    }

    this.filteredSimilar = this.gapView.sortGaps(rows,
      this.sortBy === 'relevance' ? 'default' : this.sortBy, this.effectiveRatingSource, this.sortDirection);
  }

  private ratingOf(movie: Gap): number {
    return this.gapView.ratingOf(movie, this.effectiveRatingSource);
  }

  private votesOf(movie: Gap): number {
    return this.gapView.votesOf(movie, this.effectiveRatingSource);
  }

  movieUrl(id: number, provider: 'tmdb' | 'imdb', imdbId?: string): string {
    if (provider === 'imdb') {
      return imdbId ? `https://www.imdb.com/title/${imdbId}/` : `${environment.apiUrl}/tmdb/${this.mediaType}/${id}/imdb`;
    }
    return `https://www.themoviedb.org/${this.mediaType}/${id}`;
  }

  private updateMovieLinks(): void {
    for (const movie of this.allSimilar) {
      movie.externalUrl = this.movieUrl(movie.id, this.effectiveLinkProvider, movie.imdbId);
    }
  }

  onLinkProviderChange(): void {
    this.updateMovieLinks();
    this.preferencesService.save({ externalLinkProvider: this.externalLinkProvider })
      .subscribe({ error: () => {} });
  }

  loadImdbRatings(retry = false): void {
    if (!this.showImdbRatings && this.effectiveRatingSource !== 'imdb') return;
    this.imdbRatings.load(this.allSimilar, () => {
      this.updateMovieLinks();
      this.applyFilter();
    }, retry, this.mediaType);
  }

  onRatingSourceChange(): void {
    this.applyFilter();
    this.loadImdbRatings();
    this.preferencesService.save({ ratingSource: this.ratingSource }).subscribe({ error: () => {} });
  }

  onRatingPrefsChange(): void {
    this.applyFilter();
    this.loadImdbRatings();
    this.preferencesService.save({
      showImdbRatings: this.showImdbRatings,
      showTmdbRatings: this.showTmdbRatings,
    }).subscribe({ next: () => {}, error: () => {} });
  }

  onPageChange(delta: number): void {
    this.currentPage = Math.min(this.totalPages, Math.max(1, this.currentPage + delta));
  }

  private seedKey(movie: Seed): string {
    if (movie.tmdbId) return `tmdb:${movie.tmdbId}`;
    if (this.mediaType === 'tv') {
      if (movie.tvdbId) return `tvdb:${movie.tvdbId}`;
      if (movie.imdbId) return `imdb:${movie.imdbId}`;
    }
    return '';
  }

  trackByMovie = (_index: number, movie: Seed): string => this.seedKey(movie);

  trackByGap(_index: number, gap: Gap): number {
    return gap.id;
  }

  private refreshSonarrStatus(): void {
    this.sonarrService.getConfig().pipe(catchError(() => of(null)), takeUntil(this.destroy$)).subscribe(config => {
      this.sonarrEnabled = !!config?.enabled;
      if (!this.sonarrEnabled) return;
      this.sonarrService.getLibraryTvdbIds().pipe(
        catchError(() => of({ tvdb_ids: [] })), takeUntil(this.destroy$),
      ).subscribe(response => {
        for (const id of response.tvdb_ids) this.sonarrStates.set(id, 'sent');
      });
    });
  }

  sonarrStatus(movie: Gap): SendState | undefined { return this.sonarrStates.get(movie.tvdbId!); }
  sonarrError(movie: Gap): string | undefined { return this.sonarrErrors.get(movie.tvdbId!); }
  sonarrLabel(movie: Gap): string {
    if (!movie.tvdbId) return 'No TVDB match';
    switch (this.sonarrStatus(movie)) {
      case 'sending': return 'Sending...';
      case 'sent': return 'In Sonarr';
      case 'error': return 'Retry';
      default: return 'Send to Sonarr';
    }
  }

  sendToSonarr(movie: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.mediaType !== 'tv' || !this.sonarrEnabled || movie.owned || !movie.sonarrEligible || !movie.tvdbId
        || ['sending', 'sent'].includes(this.sonarrStatus(movie) || '')) return;
    const id = movie.tvdbId;
    this.sonarrStates.set(id, 'sending');
    this.sonarrErrors.delete(id);
    this.sonarrService.addSeries(id, movie.name, {
      source: this.activeSource, server: this.activeServerName,
      library_names: [...this.radarrLibraries], root_folder_path: this.sonarrRootFolderPath,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => this.sonarrStates.set(id, 'sent'),
      error: err => {
        this.sonarrStates.set(id, 'error');
        this.sonarrErrors.set(id, err.error?.error || 'Failed to add to Sonarr');
      },
    });
  }

  private refreshRadarrStatus(): void {
    this.radarrService.getConfig().pipe(catchError(() => of(null)), takeUntil(this.destroy$)).subscribe(config => {
      this.radarrEnabled = !!config?.enabled;
      if (!this.radarrEnabled) return;
      this.radarrService.getLibraryTmdbIds().pipe(
        map(response => response.tmdb_ids || []),
        catchError(() => of([] as number[])), takeUntil(this.destroy$),
      ).subscribe(ids => {
        for (const id of ids) this.sendStatus.set(id, 'sent');
      });
    });
  }

  canSendToRadarr(movie: Gap): boolean {
    return this.mediaType === 'movie' && this.radarrEnabled && movie.radarrEligible && !movie.owned;
  }

  sendToRadarr(movie: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!this.canSendToRadarr(movie) || ['sending', 'sent'].includes(this.sendStatus.get(movie.id) || '')) return;

    this.sendStatus.set(movie.id, 'sending');
    this.sendErrors.delete(movie.id);
    this.radarrService.addMovie(
      movie.id,
      movie.name,
      parseInt(String(movie.year), 10) || 0,
      {
        source: this.activeSource, server: this.activeServerName,
        library_names: this.radarrLibraries, root_folder_path: this.radarrRootFolderPath,
      },
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
