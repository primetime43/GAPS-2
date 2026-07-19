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
import { Movie } from '../../models/movie.model';

describe('SimilarComponent', () => {
  let component: SimilarComponent;
  let fixture: ComponentFixture<SimilarComponent>;
  let libraryService: jasmine.SpyObj<LibraryService>;
  let recommendationService: jasmine.SpyObj<RecommendationService>;

  const seed: Movie = {
    name: 'Alien',
    year: 1979,
    overview: '',
    posterUrl: '',
    tmdbId: 348,
  };

  beforeEach(async () => {
    const activeServerService = jasmine.createSpyObj<ActiveServerService>('ActiveServerService', ['getActive']);
    libraryService = jasmine.createSpyObj<LibraryService>('LibraryService', ['getMovies']);
    const preferencesService = jasmine.createSpyObj<PreferencesService>('PreferencesService', ['load']);
    recommendationService = jasmine.createSpyObj<RecommendationService>('RecommendationService', ['getSimilarMovies']);
    const radarrService = jasmine.createSpyObj<RadarrService>(
      'RadarrService',
      ['getConfig', 'getLibraryTmdbIds', 'addMovie'],
    );

    const active: ActiveServer = {
      source: 'plex',
      typeLabel: 'Plex',
      server: 'Test Plex',
      libraries: [{ title: 'Movies', type: 'movie' }],
      response: {
        server: 'Test Plex',
        token: '',
        libraries: [{ title: 'Movies', type: 'movie' }],
      },
    };
    activeServerService.getActive.and.returnValue(of(active));
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES, defaultLibrary: 'Movies' }));
    libraryService.getMovies.and.returnValue(of({ movies: [seed] }));
    radarrService.getConfig.and.returnValue(of({ enabled: false } as any));
    recommendationService.getSimilarMovies.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [FormsModule, RouterTestingModule],
      declarations: [SimilarComponent],
      providers: [
        { provide: ActiveServerService, useValue: activeServerService },
        { provide: LibraryService, useValue: libraryService },
        { provide: PreferencesService, useValue: preferencesService },
        { provide: RecommendationService, useValue: recommendationService },
        { provide: RadarrService, useValue: radarrService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SimilarComponent);
    component = fixture.componentInstance;
  });

  it('loads TMDB-backed movies from the default movie library', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    expect(component.selectedLibraries).toEqual(['Movies']);
    expect(libraryService.getMovies).toHaveBeenCalledWith('Movies', 'plex');
    expect(component.movies).toEqual([seed]);
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
});
