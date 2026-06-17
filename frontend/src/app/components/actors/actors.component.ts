import { Component, OnInit, OnDestroy } from '@angular/core';
import { of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';
import { ActiveServerService } from '../../services/active-server.service';
import { ActorService } from '../../services/actor.service';
import { RecommendationService } from '../../services/recommendation.service';
import { PreferencesService } from '../../services/preferences.service';
import { ExportService, ExportFormat } from '../../services/export.service';
import { RadarrService } from '../../services/radarr.service';
import { SonarrService } from '../../services/sonarr.service';
import { TvdbService } from '../../services/tvdb.service';
import { ImdbService } from '../../services/imdb.service';
import { TmdbService, TmdbGenre } from '../../services/tmdb/tmdb.service';
import { Gap } from '../../models/recommendation.model';
import { PersonResult, PersonDetails } from '../../models/actor.model';
import { MediaLibrary } from '../../models/media-server.model';
import { environment } from '../../../environments/environment';

type SendState = 'sending' | 'sent' | 'error';
type MediaType = 'movie' | 'tv';

interface GapGroup {
  name: string;
  gaps: Gap[];
}

/**
 * Actor/actress GAPS (issue #49). Search a performer, then see their owned vs.
 * missing filmography. Search-driven and synchronous — no library scan. Reuses
 * the unified Gap model, the shared ignored_movies list (via RecommendationService),
 * the export service, and the Radarr integration, so behavior matches the
 * Missing view's movie path.
 */
@Component({
  selector: 'app-actors',
  templateUrl: './actors.component.html',
  styleUrls: ['./actors.component.scss'],
  standalone: false,
})
export class ActorsComponent implements OnInit, OnDestroy {
  loading = true;
  hasServer = false;
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';

  // Movies or TV shows — the actor's filmography is fetched accordingly.
  mediaType: MediaType = 'movie';
  private allLibraries: MediaLibrary[] = [];
  libraries: MediaLibrary[] = [];
  selectedLibraries: string[] = [];

  query = '';
  searching = false;
  searchResults: PersonResult[] = [];
  searchPerformed = false;
  selectedActor: PersonResult | null = null;

  loadingGaps = false;
  allGaps: Gap[] = [];
  collectionGroups: GapGroup[] = [];
  filteredGroups: GapGroup[] = [];
  ignoredIds: Set<number> = new Set();

  // Primary owned/missing selector — the whole point of the page.
  view: 'all' | 'owned' | 'missing' = 'all';
  // Secondary "Filters" menu toggles (checked = include that category).
  showFuture = true;
  showIgnored = false;
  // Bonus content (featurettes, making-of, "as themselves", undated) is hidden
  // by default; toggling this re-fetches with everything included.
  showMinor = false;
  resultFilter = '';
  missingCount = 0;
  ownedCount = 0;
  errorMessage = '';

  // Where poster/title clicks go. IMDb links route through the backend, which
  // resolves the IMDb ID lazily.
  externalLinkProvider: 'tmdb' | 'imdb' = 'tmdb';

  // Show IMDb/TMDB rating badges on cards, per provider (default from prefs,
  // live-toggleable from the Filters menu).
  showImdbRatings = false;
  showTmdbRatings = true;

  // Fuller profile for the selected actor, shown as a header above the results.
  actorDetails: PersonDetails | null = null;

  // Results sort + genre filter (reuse fields already on each gap).
  sortBy: 'default' | 'rating' | 'popularity' | 'year' | 'name' = 'default';
  genreFilter: number | null = null;
  genres: TmdbGenre[] = [];
  availableGenres: TmdbGenre[] = [];

  // Send-to-downloader state. The active downloader follows mediaType:
  // movies → Radarr (by TMDB id), TV → Sonarr (by TheTVDB id).
  downloaderEnabled = false;
  private sendStatus = new Map<number, SendState>();
  private sendErrors = new Map<number, string>();

  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(
    private activeServerService: ActiveServerService,
    private actorService: ActorService,
    private recommendationService: RecommendationService,
    private preferencesService: PreferencesService,
    private exportService: ExportService,
    private radarrService: RadarrService,
    private sonarrService: SonarrService,
    private tvdb: TvdbService,
    private imdbService: ImdbService,
    private tmdbService: TmdbService,
  ) {}

  ngOnInit(): void {
    this.loadIgnored();
    this.refreshDownloaderStatus();

    this.tmdbService.getGenres().pipe(catchError(() => of([] as TmdbGenre[]))).subscribe(g => {
      this.genres = g;
      this.updateAvailableGenres();
    });

    this.preferencesService.load().pipe(catchError(() => of(null))).subscribe((prefs) => {
      if (prefs) {
        this.showFuture = !prefs.hideFutureReleasesByDefault;
        this.externalLinkProvider = prefs.externalLinkProvider || 'tmdb';
        this.showImdbRatings = !!prefs.showImdbRatings;
        this.showTmdbRatings = prefs.showTmdbRatings !== false;
      }
      this.detectActiveServer(prefs);
    });

    // Debounced live search as the user types.
    this.search$.pipe(
      debounceTime(350),
      map(q => q.trim()),
      distinctUntilChanged(),
      switchMap((q) => {
        if (q.length < 2) {
          this.searching = false;
          this.searchResults = [];
          this.searchPerformed = false;
          return of([] as PersonResult[]);
        }
        this.searching = true;
        this.searchPerformed = true;
        return this.actorService.searchPeople(q).pipe(catchError(() => of([] as PersonResult[])));
      }),
      takeUntil(this.destroy$),
    ).subscribe((results) => {
      this.searching = false;
      this.searchResults = results;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private detectActiveServer(prefs: any): void {
    this.activeServerService.getActive().subscribe((active) => {
      if (active) {
        this.hasServer = true;
        this.activeSource = active.source;
        this.activeServerName = active.server;
        this.allLibraries = active.libraries;
        this.applyLibrarySelection(prefs?.defaultLibrary);
      } else {
        this.hasServer = false;
      }
      this.loading = false;
    });
  }

  /** Pick the libraries matching the current mediaType and seed the selection. */
  private applyLibrarySelection(defaultLibrary?: string): void {
    const wantType = this.mediaType === 'tv' ? 'show' : 'movie';
    this.libraries = this.allLibraries.filter(l => l.type === wantType);
    if (defaultLibrary && this.libraries.some(l => l.title === defaultLibrary)) {
      this.selectedLibraries = [defaultLibrary];
    } else {
      // Default to cross-checking ownership across every matching library.
      this.selectedLibraries = this.libraries.map(l => l.title);
    }
  }

  setMediaType(type: MediaType): void {
    if (this.mediaType === type) return;
    this.mediaType = type;
    this.applyLibrarySelection();
    this.loadIgnored();
    this.refreshDownloaderStatus();
    // Keep the current actor and just re-fetch their results for the new type;
    // only the gaps differ, not the chosen person or the search box.
    if (this.selectedActor) {
      this.selectActor(this.selectedActor);
    }
  }

  private loadIgnored(): void {
    const src$ = this.mediaType === 'tv' ? this.tvdb.getIgnored() : this.recommendationService.getIgnored();
    src$.pipe(catchError(() => of([]))).subscribe(ids => this.ignoredIds = new Set(ids));
  }

  // -- Library selection (which libraries count as "owned") --

  toggleLibrarySelection(libTitle: string): void {
    const idx = this.selectedLibraries.indexOf(libTitle);
    if (idx >= 0) {
      this.selectedLibraries.splice(idx, 1);
    } else {
      this.selectedLibraries.push(libTitle);
    }
    // Re-evaluate ownership if results are already showing.
    if (this.selectedActor && !this.loadingGaps) {
      this.selectActor(this.selectedActor);
    }
  }

  isLibrarySelected(libTitle: string): boolean {
    return this.selectedLibraries.includes(libTitle);
  }

  // -- Search & selection --

  onQueryChange(): void {
    this.search$.next(this.query);
  }

  selectActor(actor: PersonResult): void {
    this.selectedActor = actor;
    this.searchResults = [];
    this.loadingGaps = true;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.errorMessage = '';

    const libs = this.selectedLibraries.length ? this.selectedLibraries : this.libraries.map(l => l.title);
    this.actorService.getActorGaps(actor.id, libs, this.activeSource, true, this.showMinor, this.mediaType).subscribe({
      next: (res) => {
        this.actorDetails = res.actor;
        this.allGaps = this.normalizeGaps(res.gaps);
        this.applyFilter();
        this.loadImdbRatings();
        this.loadingGaps = false;
      },
      error: () => {
        this.errorMessage = "Failed to load this actor's filmography.";
        this.loadingGaps = false;
      },
    });
  }

  clearActor(): void {
    this.selectedActor = null;
    this.actorDetails = null;
    this.allGaps = [];
    this.collectionGroups = [];
    this.filteredGroups = [];
    this.resultFilter = '';
    this.errorMessage = '';
    // Reset the search box so a fresh search starts clean (issue #52).
    this.query = '';
    this.searchResults = [];
    this.searchPerformed = false;
  }

  private normalizeGaps(raw: any[]): Gap[] {
    if (!Array.isArray(raw)) return [];
    const groupName = this.selectedActor?.name ?? 'Filmography';
    if (this.mediaType === 'tv') {
      return raw.map(g => ({
        id: g.tvdbId || g.tmdbId,   // tvdbId drives Sonarr/ignore; falls back to tmdb
        name: g.name,
        year: g.year,
        releaseDate: g.releaseDate,
        posterUrl: g.posterUrl ?? null,
        overview: g.overview || '',
        groupName,
        owned: !!g.owned,
        externalUrl: this.tvExternalUrl(g.tvdbId, g.tmdbId),
        radarrEligible: false,
        sonarrEligible: !!g.tvdbId,
        tmdbRating: g.voteAverage > 0 ? g.voteAverage : undefined,
        tmdbVotes: g.voteCount || undefined,
        genreIds: g.genreIds || [],
        popularity: g.popularity || 0,
      }));
    }
    return raw.map(g => ({
      id: g.tmdbId,
      name: g.name,
      year: g.year,
      releaseDate: g.releaseDate,
      posterUrl: g.posterUrl ?? null,
      overview: g.overview || '',
      groupName,
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

  /** Build the link for a TV show — TheTVDB when known, else the TMDB page. */
  private tvExternalUrl(tvdbId: number | null | undefined, tmdbId: number | null | undefined): string {
    if (tvdbId) return `https://thetvdb.com/dereferrer/series/${tvdbId}`;
    return tmdbId ? `https://www.themoviedb.org/tv/${tmdbId}` : '';
  }

  /**
   * Live results-page switch between TMDB/IMDb links. Recomputes links in place
   * and persists the choice as the new default (mirrors the gap filters).
   */
  onLinkProviderChange(): void {
    // The provider toggle only affects movie links; TV always uses TheTVDB.
    if (this.mediaType === 'movie') {
      for (const gap of this.allGaps) gap.externalUrl = this.movieExternalUrl(gap.id);
    }
    this.preferencesService.save({ externalLinkProvider: this.externalLinkProvider })
      .subscribe({ next: () => {}, error: () => {} });
  }

  /**
   * Best-effort fetch of IMDb ratings for the loaded filmography. The backend
   * returns nothing unless the IMDb integration is enabled, so we always ask
   * rather than caching an enabled flag (which would go stale under route reuse).
   */
  private loadImdbRatings(): void {
    // IMDb ratings are resolved from TMDB *movie* ids; TV gaps key on tvdbId.
    if (!this.showImdbRatings || this.mediaType !== 'movie') return;
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

  /** Persist the per-provider rating toggles so they stick as the new default. */
  onRatingPrefsChange(): void {
    this.preferencesService.save({
      showImdbRatings: this.showImdbRatings,
      showTmdbRatings: this.showTmdbRatings,
    }).subscribe({ next: () => {}, error: () => {} });
    if (this.showImdbRatings) this.loadImdbRatings();
  }

  setView(view: 'all' | 'owned' | 'missing'): void {
    this.view = view;
    this.applyFilter();
  }

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

  // Including bonus content changes what the backend returns, so re-fetch.
  onShowMinorChange(): void {
    if (this.selectedActor) this.selectActor(this.selectedActor);
  }

  // Mirrors recommended.component's isFutureRelease.
  isFutureRelease(gap: Gap): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (gap.releaseDate) return gap.releaseDate > today;
    if (this.mediaType === 'movie') return true; // no date → unannounced/future
    const year = parseInt(String(gap.year), 10);
    return year ? year > new Date().getFullYear() : false;
  }

  isIgnored(gap: Gap): boolean {
    return this.ignoredIds.has(gap.id);
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

    const query = this.resultFilter.trim().toLowerCase();
    this.filteredGroups = !query
      ? this.collectionGroups
      : this.collectionGroups
          .map(group => ({
            name: group.name,
            gaps: group.gaps.filter(g => g.name.toLowerCase().includes(query)),
          }))
          .filter(group => group.gaps.length > 0);
  }

  // -- Ignore (movies → shared ignored_movies list; TV → TheTVDB ignore list) --

  private ignoreAdd(id: number) {
    return this.mediaType === 'tv' ? this.tvdb.addIgnored(id) : this.recommendationService.addIgnored(id);
  }
  private ignoreRemove(id: number) {
    return this.mediaType === 'tv' ? this.tvdb.removeIgnored(id) : this.recommendationService.removeIgnored(id);
  }
  private ignoreAddBulk(ids: number[]) {
    return this.mediaType === 'tv' ? this.tvdb.addIgnoredBulk(ids) : this.recommendationService.addIgnoredBulk(ids);
  }
  private ignoreRemoveBulk(ids: number[]) {
    return this.mediaType === 'tv' ? this.tvdb.removeIgnoredBulk(ids) : this.recommendationService.removeIgnoredBulk(ids);
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

  ignoreAll(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => !g.owned && !this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.add(id);
    this.ignoreAddBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.delete(id); this.applyFilter(); },
    });
    this.applyFilter();
  }

  unignoreAll(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.delete(id);
    this.ignoreRemoveBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.add(id); this.applyFilter(); },
    });
    this.applyFilter();
  }

  hasUnignoredGaps(group: GapGroup): boolean {
    return group.gaps.some(g => !g.owned && !this.ignoredIds.has(g.id));
  }

  exportResults(format: ExportFormat): void {
    const gaps = this.filteredGroups.flatMap(g => g.gaps);
    this.exportService.exportGaps(gaps, format);
  }

  // -- Send to Radarr (movies) / Sonarr (TV) --

  /** The downloader label for the active media type. */
  get downloaderName(): string {
    return this.mediaType === 'tv' ? 'Sonarr' : 'Radarr';
  }

  refreshDownloaderStatus(): void {
    this.sendStatus.clear();
    this.sendErrors.clear();
    if (this.mediaType === 'tv') {
      this.sonarrService.getConfig().pipe(catchError(() => of(null))).subscribe((cfg: any) => {
        this.downloaderEnabled = !!(cfg && cfg.enabled);
        if (!this.downloaderEnabled) return;
        this.sonarrService.getLibraryTvdbIds().pipe(
          map(res => res.tvdb_ids || []), catchError(() => of([] as number[]))
        ).subscribe(ids => this.markSent(ids));
      });
    } else {
      this.radarrService.getConfig().pipe(catchError(() => of(null))).subscribe((cfg: any) => {
        this.downloaderEnabled = !!(cfg && cfg.enabled);
        if (!this.downloaderEnabled) return;
        this.radarrService.getLibraryTmdbIds().pipe(
          map(res => res.tmdb_ids || []), catchError(() => of([] as number[]))
        ).subscribe(ids => this.markSent(ids));
      });
    }
  }

  private markSent(ids: number[]): void {
    for (const id of ids) {
      if (this.sendStatus.get(id) !== 'sending') this.sendStatus.set(id, 'sent');
    }
  }

  canSend(gap: Gap): boolean {
    const eligible = this.mediaType === 'tv' ? gap.sonarrEligible : gap.radarrEligible;
    return this.downloaderEnabled && eligible && !gap.owned && !this.isIgnored(gap);
  }

  send(gap: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!gap.id || !this.downloaderEnabled) return;
    if (this.sendStatus.get(gap.id) === 'sending') return;
    this.sendStatus.set(gap.id, 'sending');
    this.sendErrors.delete(gap.id);

    const add$ = this.mediaType === 'tv'
      ? this.sonarrService.addSeries(gap.id, gap.name)
      : this.radarrService.addMovie(gap.id, gap.name, parseInt(String(gap.year), 10) || 0);
    add$.subscribe({
      next: () => this.sendStatus.set(gap.id, 'sent'),
      error: (err: any) => {
        this.sendStatus.set(gap.id, 'error');
        this.sendErrors.set(gap.id, err.error?.error || `Failed to add to ${this.downloaderName}`);
      },
    });
  }

  sendStatusOf(id: number | undefined): SendState | undefined {
    return id ? this.sendStatus.get(id) : undefined;
  }
  sendErrorOf(id: number | undefined): string | undefined {
    return id ? this.sendErrors.get(id) : undefined;
  }
  sendButtonLabel(id: number | undefined): string {
    switch (this.sendStatusOf(id)) {
      case 'sending': return 'Sending...';
      case 'sent': return `In ${this.downloaderName}`;
      case 'error': return 'Retry';
      default: return `Send to ${this.downloaderName}`;
    }
  }
  sendButtonClass(id: number | undefined): string {
    switch (this.sendStatusOf(id)) {
      case 'sent': return 'btn-success';
      case 'error': return 'btn-outline-danger';
      default: return 'btn-outline-primary';
    }
  }
}
