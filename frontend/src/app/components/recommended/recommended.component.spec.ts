import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { FormsModule } from '@angular/forms';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { of } from 'rxjs';
import { RecommendedComponent } from './recommended.component';
import { ActiveServerService, ActiveServer, MediaServerSource } from '../../services/active-server.service';
import { MediaLibrary } from '../../models/media-server.model';
import { LibraryService } from '../../services/library.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TvdbService } from '../../services/tvdb.service';
import { PreferencesService, DEFAULT_PREFERENCES } from '../../services/preferences.service';
import { ExportService } from '../../services/export.service';
import { RadarrService } from '../../services/radarr.service';
import { SonarrService } from '../../services/sonarr.service';
import { ImdbService } from '../../services/imdb.service';
import { TmdbService } from '../../services/tmdb/tmdb.service';
import { Gap } from '../../models/recommendation.model';

@Component({ selector: 'app-confirm-modal', template: '', standalone: false })
class MockConfirmModalComponent {
  @Input() visible = false;
  @Input() title = '';
  @Input() message = '';
  @Input() confirmText = '';
  @Input() cancelText = '';
  @Input() type = 'warning';
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}

function gap(p: Partial<Gap>): Gap {
  return {
    id: 0, name: '', year: '', posterUrl: null, overview: '',
    groupName: '', owned: false, externalUrl: '', radarrEligible: false, sonarrEligible: false, ...p,
  };
}

function activeServer(source: MediaServerSource, server: string, libraries: MediaLibrary[]): ActiveServer {
  const typeLabel = ({ plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' } as const)[source];
  return { source, typeLabel, server, libraries, response: { server, token: '', libraries } };
}

describe('RecommendedComponent', () => {
  let component: RecommendedComponent;
  let fixture: ComponentFixture<RecommendedComponent>;

  let activeServerService: jasmine.SpyObj<ActiveServerService>;
  let libraryService: jasmine.SpyObj<LibraryService>;
  let recommendationService: jasmine.SpyObj<RecommendationService>;
  let tvdbService: jasmine.SpyObj<TvdbService>;
  let preferencesService: jasmine.SpyObj<PreferencesService>;
  let exportService: jasmine.SpyObj<ExportService>;
  let radarrService: jasmine.SpyObj<RadarrService>;
  let sonarrService: jasmine.SpyObj<SonarrService>;
  let imdbService: jasmine.SpyObj<ImdbService>;
  let tmdbService: jasmine.SpyObj<TmdbService>;

  beforeEach(async () => {
    activeServerService = jasmine.createSpyObj('ActiveServerService', ['getActive']);
    libraryService = jasmine.createSpyObj('LibraryService', ['getMovies', 'getShows']);
    recommendationService = jasmine.createSpyObj('RecommendationService', [
      'getGapsForMovie', 'startScan', 'getScanProgress', 'cancelScan', 'getIgnored',
      'addIgnored', 'removeIgnored', 'addIgnoredBulk', 'removeIgnoredBulk',
    ]);
    tvdbService = jasmine.createSpyObj('TvdbService', [
      'getConfig', 'getGapsForShow', 'startScan', 'getScanProgress', 'cancelScan', 'getIgnored',
      'addIgnored', 'removeIgnored', 'addIgnoredBulk', 'removeIgnoredBulk',
    ]);
    preferencesService = jasmine.createSpyObj('PreferencesService', ['load', 'save']);
    exportService = jasmine.createSpyObj('ExportService', ['exportGaps']);
    radarrService = jasmine.createSpyObj('RadarrService', ['getConfig', 'getLibraryTmdbIds', 'addMovie']);
    sonarrService = jasmine.createSpyObj('SonarrService', ['getConfig', 'getLibraryTvdbIds', 'addSeries']);
    imdbService = jasmine.createSpyObj('ImdbService', ['getConfig', 'getRatings']);

    activeServerService.getActive.and.returnValue(of(null));
    recommendationService.getIgnored.and.returnValue(of([]));
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'idle', processed: 0, total: 0, current_movie: '', collections_found: 0,
      gaps: [], total_owned: 0, libraries: [], completed_at: null, error: null,
    }));
    tvdbService.getConfig.and.returnValue(of({ enabled: false, api_key: '', pin: '', language: 'eng' }));
    tvdbService.getIgnored.and.returnValue(of([]));
    radarrService.getConfig.and.returnValue(of(null as any));
    sonarrService.getConfig.and.returnValue(of(null as any));
    preferencesService.save.and.returnValue(of({} as any));
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES }));
    imdbService.getConfig.and.returnValue(of({ datasetUrl: '' }));
    imdbService.getRatings.and.returnValue(of({ ratings: {} }));
    tmdbService = jasmine.createSpyObj('TmdbService', ['getGenres']);
    tmdbService.getGenres.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule],
      declarations: [RecommendedComponent, MockConfirmModalComponent],
      providers: [
        { provide: ActiveServerService, useValue: activeServerService },
        { provide: LibraryService, useValue: libraryService },
        { provide: RecommendationService, useValue: recommendationService },
        { provide: TvdbService, useValue: tvdbService },
        { provide: PreferencesService, useValue: preferencesService },
        { provide: ExportService, useValue: exportService },
        { provide: RadarrService, useValue: radarrService },
        { provide: SonarrService, useValue: sonarrService },
        { provide: ImdbService, useValue: imdbService },
        { provide: TmdbService, useValue: tmdbService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecommendedComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect Plex as active source and load movie libraries', fakeAsync(() => {
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'My Plex',
      [{ title: 'Movies', type: 'movie' }, { title: 'TV', type: 'show' }])));
    fixture.detectChanges();
    tick();

    expect(component.hasServer).toBeTrue();
    expect(component.activeSource).toBe('plex');
    expect(component.activeServerName).toBe('My Plex');
    // Default media type is movie → only movie libraries shown.
    expect(component.libraries.length).toBe(1);
    expect(component.libraries[0].title).toBe('Movies');
    expect(component.loading).toBeFalse();
  }));

  it('should show TV libraries after switching media type', fakeAsync(() => {
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'My Plex',
      [{ title: 'Movies', type: 'movie' }, { title: 'TV', type: 'show' }])));
    fixture.detectChanges();
    tick();

    component.setMediaType('tv');
    expect(component.mediaType).toBe('tv');
    expect(component.libraries.length).toBe(1);
    expect(component.libraries[0].title).toBe('TV');
  }));

  it('should detect Emby when Plex is not connected', fakeAsync(() => {
    activeServerService.getActive.and.returnValue(of(activeServer('emby', 'My Emby',
      [{ title: 'Films', type: 'movie' }])));
    fixture.detectChanges();
    tick();

    expect(component.activeSource).toBe('emby');
    expect(component.activeServerName).toBe('My Emby');
  }));

  it('should auto-select default library from preferences', fakeAsync(() => {
    preferencesService.load.and.returnValue(of({
      ...DEFAULT_PREFERENCES, defaultLibrary: 'Movies', moviesPerPage: 25, hideOwnedByDefault: true,
    }));
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'Plex',
      [{ title: 'Movies', type: 'movie' }])));
    libraryService.getMovies.and.returnValue(of({ movies: [] }));
    fixture.detectChanges();
    tick();

    expect(component.selectedLibraries).toContain('Movies');
    expect(component.itemsPerPage).toBe(25);
    expect(component.view).toBe('missing');
  }));

  it('should load items when a library is selected', fakeAsync(() => {
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'Plex',
      [{ title: 'Movies', type: 'movie' }])));
    fixture.detectChanges();
    tick();

    const mockMovies = [
      { name: 'Alien', year: 1979, overview: '', posterUrl: '', tmdbId: 348 },
      { name: 'Aliens', year: 1986, overview: '', posterUrl: '', tmdbId: 679 },
    ];
    libraryService.getMovies.and.returnValue(of({ movies: mockMovies } as any));

    component.selectedLibraries = ['Movies'];
    component.loadItems();
    tick();

    expect(component.items.length).toBe(2);
    expect(component.loadingItems).toBeFalse();
  }));

  it('filteredItems should filter by itemFilter text', () => {
    component.items = [
      { name: 'Alien', year: 1979, posterUrl: '' },
      { name: 'The Matrix', year: 1999, posterUrl: '' },
    ];
    component.itemFilter = 'alien';
    expect(component.filteredItems.length).toBe(1);
    expect(component.filteredItems[0].name).toBe('Alien');

    component.itemFilter = '';
    expect(component.filteredItems.length).toBe(2);
  });

  it('pagedItems should respect itemsPerPage and currentPage', () => {
    component.items = Array.from({ length: 75 }, (_, i) => ({ name: `Movie ${i}`, year: 2000, posterUrl: '' }));
    component.itemsPerPage = 50;
    component.currentPage = 1;
    expect(component.pagedItems.length).toBe(50);
    expect(component.totalPages).toBe(2);

    component.currentPage = 2;
    expect(component.pagedItems.length).toBe(25);
  });

  it('applyFilter should group gaps by group and filter owned/ignored', () => {
    component.allGaps = [
      gap({ id: 1, name: 'Alien', groupName: 'Alien Collection', owned: true }),
      gap({ id: 2, name: 'Aliens', groupName: 'Alien Collection', owned: false }),
      gap({ id: 3, name: 'Matrix', groupName: 'Matrix Collection', owned: false }),
    ];
    component.view = 'missing';
    component.showIgnored = false;
    component.ignoredIds = new Set();

    component.applyFilter();
    expect(component.collectionGroups.length).toBe(2);
    expect(component.missingCount).toBe(2);

    component.view = 'all';
    component.applyFilter();
    const alienGroup = component.collectionGroups.find(g => g.name === 'Alien Collection');
    expect(alienGroup?.gaps.length).toBe(2);
  });

  it('applyFilter should hide ignored items when showIgnored is false', () => {
    component.allGaps = [
      gap({ id: 1, name: 'Movie A', groupName: 'Coll', owned: false }),
      gap({ id: 2, name: 'Movie B', groupName: 'Coll', owned: false }),
    ];
    component.ignoredIds = new Set([1]);
    component.view = 'all';
    component.showIgnored = false;

    component.applyFilter();
    expect(component.filteredGroups.length).toBe(1);
    expect(component.filteredGroups[0].gaps.length).toBe(1);
    expect(component.filteredGroups[0].gaps[0].id).toBe(2);
  });

  it('applyFilter should hide future releases when showFuture is false', () => {
    const future = '2099-12-31';
    const past = '1999-01-01';
    component.allGaps = [
      gap({ id: 1, name: 'Released', year: '1999', releaseDate: past, groupName: 'C', owned: false }),
      gap({ id: 2, name: 'Future', year: '2099', releaseDate: future, groupName: 'C', owned: false }),
      gap({ id: 3, name: 'Unannounced', year: 'N/A', releaseDate: '', groupName: 'C', owned: false }),
      gap({ id: 4, name: 'Owned future', year: '2099', releaseDate: future, groupName: 'C', owned: true }),
    ];
    component.ignoredIds = new Set();
    component.view = 'all';
    component.showIgnored = true;
    component.showFuture = false;

    component.applyFilter();
    const titles = component.filteredGroups.flatMap(g => g.gaps.map(x => x.name));
    expect(titles).toContain('Released');
    expect(titles).toContain('Owned future');
    expect(titles).not.toContain('Future');
    expect(titles).not.toContain('Unannounced');
    expect(component.missingCount).toBe(1);
  });

  it('toggleIgnore should add/remove from ignored set', () => {
    const g = gap({ id: 42, name: 'Test', groupName: 'C', owned: false });
    component.allGaps = [g];
    component.ignoredIds = new Set();
    recommendationService.addIgnored.and.returnValue(of({}));
    recommendationService.removeIgnored.and.returnValue(of({}));

    const event = new Event('click');
    component.toggleIgnore(g, event);
    expect(component.ignoredIds.has(42)).toBeTrue();

    component.toggleIgnore(g, event);
    expect(component.ignoredIds.has(42)).toBeFalse();
  });

  it('toggleLibrarySelection should add/remove from selectedLibraries', () => {
    component.selectedLibraries = ['Movies'];
    component.toggleLibrarySelection('TV');
    expect(component.selectedLibraries).toEqual(['Movies', 'TV']);

    component.toggleLibrarySelection('Movies');
    expect(component.selectedLibraries).toEqual(['TV']);
  });

  it('clearResults should reset all result state', () => {
    component.selectedItem = { name: 'Test', year: 2020, posterUrl: '' };
    component.scanMode = true;
    component.allGaps = [gap({ id: 1, name: 'X', groupName: 'C', owned: false })];
    component.errorMessage = 'some error';

    component.clearResults();

    expect(component.selectedItem).toBeNull();
    expect(component.scanMode).toBeFalse();
    expect(component.allGaps).toEqual([]);
    expect(component.collectionGroups).toEqual([]);
    expect(component.errorMessage).toBe('');
  });

  it('scanLibrary with freshScan=true should show confirmation first', () => {
    component.scanLibrary(true);
    expect(component.showFreshScanConfirm).toBeTrue();
  });

  it('movie scan should persist the quality filter before starting', fakeAsync(() => {
    component.mediaType = 'movie';
    component.activeSource = 'plex';
    component.selectedLibraries = ['Movies'];
    component.qualityFilter = true;
    component.minRating = 6.5;
    component.minVoteCount = 200;

    libraryService.getMovies.and.returnValue(of({ movies: [{ name: 'X', year: 2000, tmdbId: 1 }] } as any));
    recommendationService.startScan.and.returnValue(of({ status: 'started', total: 1 } as any));

    component.scanLibrary(false);
    tick();

    expect(preferencesService.save).toHaveBeenCalledWith(
      jasmine.objectContaining({ qualityFilterEnabled: true, minRating: 6.5, minVoteCount: 200 })
    );
    expect(recommendationService.startScan).toHaveBeenCalled();
  }));

  it('onFreshScanCancel should dismiss the confirmation', () => {
    component.showFreshScanConfirm = true;
    component.onFreshScanCancel();
    expect(component.showFreshScanConfirm).toBeFalse();
  });

  it('searchFilter should filter groups by name or title', () => {
    component.allGaps = [
      gap({ id: 1, name: 'Alien', groupName: 'Alien Collection', owned: false }),
      gap({ id: 2, name: 'The Matrix', groupName: 'Matrix Collection', owned: false }),
    ];
    component.view = 'all';
    component.showIgnored = true;
    component.ignoredIds = new Set();

    component.searchFilter = 'alien';
    component.applyFilter();

    expect(component.filteredGroups.length).toBe(1);
    expect(component.filteredGroups[0].name).toBe('Alien Collection');
  });

  it('exportResults should call exportService with filtered gaps', () => {
    component.filteredGroups = [{
      name: 'Coll',
      gaps: [gap({ id: 1, name: 'Movie', groupName: 'Coll', owned: false })],
    }];

    component.exportResults('csv');
    expect(exportService.exportGaps).toHaveBeenCalledWith(component.filteredGroups[0].gaps, 'csv');
  });

  it('should stop polling on destroy', () => {
    (component as any).pollSub = of(0).subscribe();
    component.ngOnDestroy();
    expect((component as any).pollSub).toBeNull();
  });
});
