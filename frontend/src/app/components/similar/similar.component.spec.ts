import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
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
