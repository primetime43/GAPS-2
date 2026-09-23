import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of, Subject, throwError } from 'rxjs';
import { SimilarComponent } from './similar.component';
import { ActiveServerService, ActiveServer } from '../../services/active-server.service';
import { LibraryService } from '../../services/library.service';
import { PreferencesService, DEFAULT_PREFERENCES } from '../../services/preferences.service';
import { RecommendationService } from '../../services/recommendation.service';
import { RadarrService } from '../../services/radarr.service';
import { GapViewService } from '../../services/gap-view.service';
import { Movie } from '../../models/movie.model';
import { Gap } from '../../models/recommendation.model';
import { CompactNumberPipe } from '../../pipes/compact-number.pipe';

describe('SimilarComponent', () => {
  let component: SimilarComponent;
  let fixture: ComponentFixture<SimilarComponent>;
  let activeServerService: jasmine.SpyObj<ActiveServerService>;
  let libraryService: jasmine.SpyObj<LibraryService>;
  let recommendationService: jasmine.SpyObj<RecommendationService>;
  let preferencesService: jasmine.SpyObj<PreferencesService>;
  let gapView: jasmine.SpyObj<GapViewService>;
  const librarySelectionsKey = 'gaps2.similar.librarySelections';

  const seed: Movie = {
    name: 'Alien',
    year: 1979,
    overview: '',
    posterUrl: '',
    tmdbId: 348,
  };

  beforeEach(async () => {
    localStorage.removeItem(librarySelectionsKey);
    activeServerService = jasmine.createSpyObj<ActiveServerService>('ActiveServerService', ['getActive']);
    libraryService = jasmine.createSpyObj<LibraryService>('LibraryService', ['getMovies']);
    preferencesService = jasmine.createSpyObj<PreferencesService>('PreferencesService', ['load', 'save']);
    recommendationService = jasmine.createSpyObj<RecommendationService>('RecommendationService', ['getSimilarMovies']);
    gapView = jasmine.createSpyObj<GapViewService>(
      'GapViewService',
      ['ratingOf', 'votesOf', 'applyImdbRatings'],
    );
    const radarrService = jasmine.createSpyObj<RadarrService>(
      'RadarrService',
      ['getConfig', 'getLibraryTmdbIds', 'addMovie'],
    );

    const active: ActiveServer = {
      source: 'plex',
      typeLabel: 'Plex',
      server: 'Test Plex',
      libraries: [
        { title: 'Movies', type: 'movie' },
        { title: '4K Movies', type: 'movie' },
      ],
      response: {
        server: 'Test Plex',
        token: '',
        libraries: [
          { title: 'Movies', type: 'movie' },
          { title: '4K Movies', type: 'movie' },
        ],
      },
    };
    activeServerService.getActive.and.returnValue(of(active));
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES, defaultLibrary: 'Movies' }));
    preferencesService.save.and.returnValue(of({ ...DEFAULT_PREFERENCES }));
    gapView.ratingOf.and.callFake(gap => gap.imdbRating ?? gap.tmdbRating ?? 0);
    gapView.votesOf.and.callFake(gap => gap.imdbRating != null ? (gap.imdbVotes ?? 0) : (gap.tmdbVotes ?? 0));
    gapView.applyImdbRatings.and.returnValue(of(undefined));
    libraryService.getMovies.and.returnValue(of({ movies: [seed] }));
    radarrService.getConfig.and.returnValue(of({ enabled: false } as any));
    recommendationService.getSimilarMovies.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [FormsModule, RouterTestingModule],
      declarations: [SimilarComponent, CompactNumberPipe],
      providers: [
        { provide: ActiveServerService, useValue: activeServerService },
        { provide: LibraryService, useValue: libraryService },
        { provide: PreferencesService, useValue: preferencesService },
        { provide: RecommendationService, useValue: recommendationService },
        { provide: RadarrService, useValue: radarrService },
        { provide: GapViewService, useValue: gapView },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SimilarComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => localStorage.removeItem(librarySelectionsKey));

  it('displays library failures instead of silently showing an empty library', () => {
    libraryService.getMovies.and.returnValue(throwError(() => ({ error: { error: 'Server offline' } })));
    fixture.detectChanges();
    expect(component.errorMessage).toBe('Server offline');
    expect(component.loadingMovies).toBeFalse();
  });

  it('ignores library results from a previous selection', () => {
    const pending = new Subject<any>();
    libraryService.getMovies.and.returnValue(pending);
    fixture.detectChanges();
    component.selectedLibraries = [];
    component.loadMovies();
    pending.next({ movies: [seed] });
    expect(component.movies).toEqual([]);
  });

  it('does not resurrect results after clearing a pending similar lookup', () => {
    const pending = new Subject<any>();
    recommendationService.getSimilarMovies.and.returnValue(pending);
    component.selectMovie(seed);
    component.clearResults();
    pending.next([{ tmdbId: 2, name: 'Old result' }]);
    expect(component.allSimilar).toEqual([]);
    expect(component.loadingSimilar).toBeFalse();
  });

  it('honors the global IMDb link preference', () => {
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES, externalLinkProvider: 'imdb' }));
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    fixture.detectChanges();
    component.selectMovie(seed);
    expect(component.allSimilar[0].externalUrl).toBe('/api/tmdb/movie/2/imdb');
  });

  it('loads IMDb automatically for new results when the preference is enabled', () => {
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES, showImdbRatings: true }));
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    const pending = new Subject<void>();
    gapView.applyImdbRatings.and.returnValue(pending);
    fixture.detectChanges();
    component.selectMovie(seed);
    fixture.detectChanges();

    expect(gapView.applyImdbRatings).toHaveBeenCalledOnceWith(component.allSimilar, { suppressErrors: false });
    expect(component.loadingImdbRatings).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.rec-card').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Loading IMDb ratings');
    pending.next();
    expect(component.loadingImdbRatings).toBeFalse();
  });

  it('loads ratings when enabled and reuses them after toggling off and on', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    component.selectMovie(seed);
    expect(gapView.applyImdbRatings).not.toHaveBeenCalled();
    component.showImdbRatings = true;
    component.onRatingPrefsChange();
    component.showImdbRatings = false;
    component.onRatingPrefsChange();
    component.showImdbRatings = true;
    component.onRatingPrefsChange();
    expect(gapView.applyImdbRatings).toHaveBeenCalledTimes(1);
    expect(preferencesService.save).toHaveBeenCalledWith({ showImdbRatings: true, showTmdbRatings: true });
  });

  it('keeps IMDb and TMDB links available without loading ratings', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    fixture.detectChanges();
    component.showImdbRatings = false;
    component.showTmdbRatings = false;
    component.selectMovie(seed);
    fixture.detectChanges();

    const imdbLink: HTMLAnchorElement = fixture.nativeElement.querySelector('.rating-chip.imdb');
    const tmdbLink: HTMLAnchorElement = fixture.nativeElement.querySelector('.rating-chip.tmdb');
    expect(imdbLink.getAttribute('href')).toBe('/api/tmdb/movie/2/imdb');
    expect(tmdbLink.href).toBe('https://www.themoviedb.org/movie/2');
    expect(imdbLink.target).toBe('_blank');
    expect(gapView.applyImdbRatings).not.toHaveBeenCalled();

    component.externalLinkProvider = 'imdb';
    component.onLinkProviderChange();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.rec-title-link').getAttribute('href')).toBe('/api/tmdb/movie/2/imdb');
    expect(preferencesService.save).toHaveBeenCalledWith({ externalLinkProvider: 'imdb' });
  });

  it('uses the resolved IMDb ID for links after loading ratings', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    gapView.applyImdbRatings.and.callFake(gaps => {
      gaps[0].imdbId = 'tt1234567';
      gaps[0].imdbRating = 7;
      return of(undefined);
    });
    component.externalLinkProvider = 'imdb';
    component.showImdbRatings = true;
    component.selectMovie(seed);
    expect(component.allSimilar[0].externalUrl).toBe('https://www.imdb.com/title/tt1234567/');
  });

  it('shows a retry after a ratings failure and recovers without reloading movies', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    gapView.applyImdbRatings.and.returnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();
    component.showImdbRatings = true;
    component.selectMovie(seed);
    fixture.detectChanges();

    expect(component.loadingImdbRatings).toBeFalse();
    expect(component.imdbRatingsLoaded).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Could not load IMDb ratings');
    expect(component.filteredSimilar.length).toBe(1);
    gapView.applyImdbRatings.and.returnValue(of(undefined));
    fixture.nativeElement.querySelector('.imdb-status button').click();
    expect(component.imdbRatingsError).toBe('');
    expect(component.imdbRatingsLoaded).toBeTrue();
    expect(recommendationService.getSimilarMovies).toHaveBeenCalledTimes(1);
  });

  it('explains empty and partial IMDb results and allows another attempt', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([
      { tmdbId: 2, name: 'One' }, { tmdbId: 3, name: 'Two' },
    ] as any));
    fixture.detectChanges();
    component.showImdbRatings = true;
    component.selectMovie(seed);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No IMDb ratings were found.');
    expect(fixture.nativeElement.querySelector('.imdb-status a').getAttribute('href')).toBe('/settings/imdb');

    gapView.applyImdbRatings.and.callFake(gaps => {
      gaps[0].imdbRating = 7;
      return of(undefined);
    });
    fixture.nativeElement.querySelector('.imdb-status button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('IMDb ratings available for 1 of 2 movies.');
    expect(gapView.applyImdbRatings).toHaveBeenCalledTimes(2);
  });

  it('ignores old ratings requests when selecting another movie', () => {
    recommendationService.getSimilarMovies.and.returnValue(of([{ tmdbId: 2, name: 'Similar title' }] as any));
    const previous = new Subject<void>();
    const current = new Subject<void>();
    gapView.applyImdbRatings.and.returnValues(previous, current);
    component.showImdbRatings = true;
    component.selectMovie(seed);
    component.selectMovie({ ...seed, tmdbId: 999 });
    previous.next();
    expect(component.loadingImdbRatings).toBeTrue();
    expect(component.imdbRatingsLoaded).toBeFalse();
    current.next();
    expect(component.loadingImdbRatings).toBeFalse();
  });

  it('allows going back while the similar search is still loading', () => {
    const pending = new Subject<any>();
    recommendationService.getSimilarMovies.and.returnValue(pending);
    fixture.detectChanges();
    component.selectMovie(seed);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('TMDB did not return any similar movies');
    fixture.nativeElement.querySelector('.result-toolbar button').click();
    pending.next([{ tmdbId: 2, name: 'Old result' }]);
    expect(component.selectedMovie).toBeNull();
    expect(component.allSimilar).toEqual([]);
  });

  it('loads TMDB-backed movies from the default movie library', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    expect(component.selectedLibraries).toEqual(['Movies']);
    expect(libraryService.getMovies).toHaveBeenCalledWith('Movies', 'plex');
    expect(component.movies).toEqual([seed]);
  }));

  it('restores the selected libraries for the active media server', fakeAsync(() => {
    localStorage.setItem(librarySelectionsKey, JSON.stringify({
      'plex:Test Plex': ['4K Movies'],
    }));

    fixture.detectChanges();
    tick();

    expect(component.selectedLibraries).toEqual(['4K Movies']);
    expect(libraryService.getMovies).toHaveBeenCalledWith('4K Movies', 'plex');
  }));

  it('persists library checkbox changes for the active media server', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    component.toggleLibrarySelection('4K Movies');
    tick();

    expect(JSON.parse(localStorage.getItem(librarySelectionsKey) || '{}')).toEqual({
      'plex:Test Plex': ['Movies', '4K Movies'],
    });
  }));

  it('uses the selected movie TMDB ID and marks owned and missing results', fakeAsync(() => {
    recommendationService.getSimilarMovies.and.returnValue(of([
      {
        tmdbId: 1, name: 'Owned', year: '2000', posterUrl: null,
        overview: '', collectionName: 'Similar Movies', owned: true,
      },
      {
        tmdbId: 2, name: 'Missing', year: '2001', posterUrl: null,
        overview: '', collectionName: 'Similar Movies', owned: false,
      },
    ]));
    component.selectedLibraries = ['Movies'];

    component.selectMovie(seed);
    tick();

    expect(recommendationService.getSimilarMovies).toHaveBeenCalledWith(348, ['Movies'], 'plex');
    expect(component.ownedCount).toBe(1);
    expect(component.missingCount).toBe(1);

    component.setView('missing');
    expect(component.filteredSimilar.map(movie => movie.name)).toEqual(['Missing']);
  }));

  it('does not query TMDB when the selected movie has no TMDB ID', () => {
    component.selectMovie({ ...seed, name: 'Unknown', tmdbId: undefined });

    expect(recommendationService.getSimilarMovies).not.toHaveBeenCalled();
    expect(component.errorMessage).toContain('no TMDB ID');
  });

  it('filters misleading sparse ratings by minimum vote count', fakeAsync(() => {
    recommendationService.getSimilarMovies.and.returnValue(of([
      {
        tmdbId: 1, name: 'Two Votes', year: '2024', posterUrl: null,
        overview: '', collectionName: 'Similar Movies', owned: false,
        voteAverage: 7, voteCount: 2,
      },
      {
        tmdbId: 2, name: 'Established', year: '2023', posterUrl: null,
        overview: '', collectionName: 'Similar Movies', owned: false,
        voteAverage: 6.5, voteCount: 189,
      },
    ]));
    component.selectedLibraries = ['Movies'];
    component.minVoteCount = 100;

    component.selectMovie(seed);
    tick();

    expect(component.filteredSimilar.map(movie => movie.name)).toEqual(['Established']);
  }));

  it('loads IMDb ratings and uses them for rating filters and sorting', () => {
    const lowerTmdbButBetterImdb: Gap = {
      id: 1, name: 'IMDb Winner', year: 2024, posterUrl: null, overview: '',
      groupName: 'Similar Movies', owned: false, externalUrl: '',
      radarrEligible: true, sonarrEligible: false, tmdbRating: 5, tmdbVotes: 500,
    };
    const higherTmdb: Gap = {
      id: 2, name: 'TMDB Winner', year: 2024, posterUrl: null, overview: '',
      groupName: 'Similar Movies', owned: false, externalUrl: '',
      radarrEligible: true, sonarrEligible: false, tmdbRating: 8, tmdbVotes: 500,
    };
    component.allSimilar = [higherTmdb, lowerTmdbButBetterImdb];
    component.showImdbRatings = true;
    component.sortBy = 'rating';
    gapView.applyImdbRatings.and.callFake(gaps => {
      gaps[0].imdbRating = 4.4;
      gaps[0].imdbVotes = 189;
      gaps[1].imdbRating = 9.1;
      gaps[1].imdbVotes = 1000;
      return of(undefined);
    });

    component.loadImdbRatings();

    expect(component.imdbRatingsLoaded).toBeTrue();
    expect(component.filteredSimilar.map(movie => movie.name)).toEqual(['IMDb Winner', 'TMDB Winner']);

    component.showImdbRatings = false;
    component.onRatingPrefsChange();
    expect(component.filteredSimilar.map(movie => movie.name)).toEqual(['TMDB Winner', 'IMDb Winner']);
    component.minRating = 7;
    component.minVoteCount = 400;
    component.applyFilter();
    expect(component.filteredSimilar.map(movie => movie.name)).toEqual(['TMDB Winner']);
  });

  it('starts with configured quality thresholds when that preference is enabled', fakeAsync(() => {
    preferencesService.load.and.returnValue(of({
      ...DEFAULT_PREFERENCES,
      defaultLibrary: 'Movies',
      qualityFilterEnabled: true,
      minRating: 6,
      minVoteCount: 100,
    }));

    fixture.detectChanges();
    tick();

    expect(component.minRating).toBe(6);
    expect(component.minVoteCount).toBe(100);
  }));
});
