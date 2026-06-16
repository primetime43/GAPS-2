import { Component, OnInit, OnDestroy } from '@angular/core';
import { of, Subject } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, map, switchMap, takeUntil } from 'rxjs/operators';
import { ActiveServerService } from '../../services/active-server.service';
import { ActorService } from '../../services/actor.service';
import { RecommendationService } from '../../services/recommendation.service';
import { PreferencesService } from '../../services/preferences.service';
import { ExportService, ExportFormat } from '../../services/export.service';
import { RadarrService } from '../../services/radarr.service';
import { ImdbService } from '../../services/imdb.service';
import { TmdbService, TmdbGenre } from '../../services/tmdb/tmdb.service';
import { Gap } from '../../models/recommendation.model';
import { PersonResult, PersonDetails } from '../../models/actor.model';
import { MediaLibrary } from '../../models/media-server.model';
import { environment } from '../../../environments/environment';

type SendState = 'sending' | 'sent' | 'error';

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

  // Fuller profile for the selected actor, shown as a header above the results.
  actorDetails: PersonDetails | null = null;

  // Results sort + genre filter (reuse fields already on each gap).
  sortBy: 'default' | 'rating' | 'popularity' | 'year' | 'name' = 'default';
  genreFilter: number | null = null;
  genres: TmdbGenre[] = [];
  availableGenres: TmdbGenre[] = [];

  // Radarr send state (movies only).
  radarrEnabled = false;
  private radarrStatus = new Map<number, SendState>();
  private radarrErrors = new Map<number, string>();

  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(
    private activeServerService: ActiveServerService,
    private actorService: ActorService,
    private recommendationService: RecommendationService,
    private preferencesService: PreferencesService,
    private exportService: ExportService,
    private radarrService: RadarrService,
    private imdbService: ImdbService,
    private tmdbService: TmdbService,
  ) {}

  ngOnInit(): void {
    this.loadIgnored();
    this.refreshRadarrStatus();

    this.tmdbService.getGenres().pipe(catchError(() => of([] as TmdbGenre[]))).subscribe(g => {
      this.genres = g;
      this.updateAvailableGenres();
    });

    this.preferencesService.load().pipe(catchError(() => of(null))).subscribe((prefs) => {
      if (prefs) {
        this.showFuture = !prefs.hideFutureReleasesByDefault;
        this.externalLinkProvider = prefs.externalLinkProvider || 'tmdb';
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
        this.libraries = active.libraries.filter(l => l.type === 'movie');
        // Default to the configured default library if it's a movie library,
        // otherwise cross-check ownership against every movie library.
        if (prefs?.defaultLibrary && this.libraries.some(l => l.title === prefs.defaultLibrary)) {
          this.selectedLibraries = [prefs.defaultLibrary];
        } else {
          this.selectedLibraries = this.libraries.map(l => l.title);
        }
      } else {
        this.hasServer = false;
      }
      this.loading = false;
    });
  }

  private loadIgnored(): void {
    this.recommendationService.getIgnored().pipe(catchError(() => of([]))).subscribe(
      ids => this.ignoredIds = new Set(ids)
    );
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
    this.actorService.getActorGaps(actor.id, libs, this.activeSource, true, this.showMinor).subscribe({
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
    return raw.map(g => ({
      id: g.tmdbId,
      name: g.name,
      year: g.year,
      releaseDate: g.releaseDate,
      posterUrl: g.posterUrl ?? null,
      overview: g.overview || '',
      groupName: g.collectionName || (this.selectedActor?.name ?? 'Filmography'),
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
   * Live results-page switch between TMDB/IMDb links. Recomputes links in place
   * and persists the choice as the new default (mirrors the gap filters).
   */
  onLinkProviderChange(): void {
    for (const gap of this.allGaps) gap.externalUrl = this.movieExternalUrl(gap.id);
    this.preferencesService.save({ externalLinkProvider: this.externalLinkProvider })
      .subscribe({ next: () => {}, error: () => {} });
  }

  /**
   * Best-effort fetch of IMDb ratings for the loaded filmography. The backend
   * returns nothing unless the IMDb integration is enabled, so we always ask
   * rather than caching an enabled flag (which would go stale under route reuse).
   */
  private loadImdbRatings(): void {
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

  // Mirrors the movie branch of recommended.component's isFutureRelease.
  isFutureRelease(gap: Gap): boolean {
    const today = new Date().toISOString().slice(0, 10);
    if (gap.releaseDate) return gap.releaseDate > today;
    return true; // movie with no date → unannounced/future
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

  // -- Ignore (shared ignored_movies list) --

  toggleIgnore(gap: Gap, event: Event): void {
    event.stopPropagation();
    if (this.ignoredIds.has(gap.id)) {
      this.ignoredIds.delete(gap.id);
      this.recommendationService.removeIgnored(gap.id).subscribe({ error: () => this.ignoredIds.add(gap.id) });
    } else {
      this.ignoredIds.add(gap.id);
      this.recommendationService.addIgnored(gap.id).subscribe({ error: () => this.ignoredIds.delete(gap.id) });
    }
    this.applyFilter();
  }

  ignoreAll(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => !g.owned && !this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.add(id);
    this.recommendationService.addIgnoredBulk(ids).subscribe({
      error: () => { for (const id of ids) this.ignoredIds.delete(id); this.applyFilter(); },
    });
    this.applyFilter();
  }

  unignoreAll(group: GapGroup, event: Event): void {
    event.stopPropagation();
    const ids = group.gaps.filter(g => this.ignoredIds.has(g.id)).map(g => g.id);
    if (!ids.length) return;
    for (const id of ids) this.ignoredIds.delete(id);
    this.recommendationService.removeIgnoredBulk(ids).subscribe({
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

  // -- Radarr --

  refreshRadarrStatus(): void {
    this.radarrService.getConfig().pipe(catchError(() => of(null))).subscribe((cfg: any) => {
      this.radarrEnabled = !!(cfg && cfg.enabled);
      if (!this.radarrEnabled) return;
      this.radarrService.getLibraryTmdbIds().pipe(
        map(res => res.tmdb_ids || []), catchError(() => of([] as number[]))
      ).subscribe((ids) => {
        for (const id of ids) {
          if (this.radarrStatus.get(id) !== 'sending') this.radarrStatus.set(id, 'sent');
        }
      });
    });
  }

  canSendToRadarr(gap: Gap): boolean {
    return this.radarrEnabled && gap.radarrEligible && !gap.owned && !this.isIgnored(gap);
  }

  sendToRadarr(gap: Gap, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    if (!gap.id || !this.radarrEnabled || !gap.radarrEligible) return;
    if (this.radarrStatus.get(gap.id) === 'sending') return;
    this.radarrStatus.set(gap.id, 'sending');
    this.radarrErrors.delete(gap.id);
    this.radarrService.addMovie(gap.id, gap.name, parseInt(String(gap.year), 10) || 0).subscribe({
      next: () => this.radarrStatus.set(gap.id, 'sent'),
      error: (err: any) => {
        this.radarrStatus.set(gap.id, 'error');
        this.radarrErrors.set(gap.id, err.error?.error || 'Failed to add to Radarr');
      },
    });
  }

  radarrStatusOf(id: number | undefined): SendState | undefined {
    return id ? this.radarrStatus.get(id) : undefined;
  }
  radarrErrorOf(id: number | undefined): string | undefined {
    return id ? this.radarrErrors.get(id) : undefined;
  }
  radarrButtonLabel(id: number | undefined): string {
    switch (this.radarrStatusOf(id)) {
      case 'sending': return 'Sending...';
      case 'sent': return 'In Radarr';
      case 'error': return 'Retry';
      default: return 'Send to Radarr';
    }
  }
  radarrButtonClass(id: number | undefined): string {
    switch (this.radarrStatusOf(id)) {
      case 'sent': return 'btn-success';
      case 'error': return 'btn-outline-danger';
      default: return 'btn-outline-primary';
    }
  }
}
