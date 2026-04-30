import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { FormsModule } from '@angular/forms';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { of, throwError } from 'rxjs';
import { RecommendedComponent } from './recommended.component';
import { PlexService } from '../../services/plex.service';
import { JellyfinService } from '../../services/jellyfin.service';
import { EmbyService } from '../../services/emby.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService } from '../../services/recommendation.service';
import { PreferencesService } from '../../services/preferences.service';
import { ExportService } from '../../services/export.service';
import { CollectionGap } from '../../models/recommendation.model';

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

describe('RecommendedComponent', () => {
  let component: RecommendedComponent;
  let fixture: ComponentFixture<RecommendedComponent>;

  let plexService: jasmine.SpyObj<PlexService>;
  let jellyfinService: jasmine.SpyObj<JellyfinService>;
  let embyService: jasmine.SpyObj<EmbyService>;
  let libraryService: jasmine.SpyObj<LibraryService>;
  let recommendationService: jasmine.SpyObj<RecommendationService>;
  let preferencesService: jasmine.SpyObj<PreferencesService>;
  let exportService: jasmine.SpyObj<ExportService>;

  beforeEach(async () => {
    plexService = jasmine.createSpyObj('PlexService', ['getActiveServer']);
    jellyfinService = jasmine.createSpyObj('JellyfinService', ['getActiveServer']);
    embyService = jasmine.createSpyObj('EmbyService', ['getActiveServer']);
    libraryService = jasmine.createSpyObj('LibraryService', ['getMovies']);
    recommendationService = jasmine.createSpyObj('RecommendationService', [
      'getGapsForMovie', 'startScan', 'getScanProgress', 'getIgnored',
      'addIgnored', 'removeIgnored', 'addIgnoredBulk', 'removeIgnoredBulk',
    ]);
    preferencesService = jasmine.createSpyObj('PreferencesService', ['load', 'save']);
    exportService = jasmine.createSpyObj('ExportService', ['exportGaps']);

    // Default mock returns
    plexService.getActiveServer.and.returnValue(of({} as any));
    jellyfinService.getActiveServer.and.returnValue(of({} as any));
    embyService.getActiveServer.and.returnValue(of({} as any));
    recommendationService.getIgnored.and.returnValue(of([]));
    preferencesService.load.and.returnValue(of({
      defaultLibrary: '',
      moviesPerPage: 50,
      hideOwnedByDefault: false,
      hideFutureReleasesByDefault: false,
      language: 'en',
      port: 4277,
      autoOpenBrowser: true,
      posterPrefetch: false,
      imageCacheEnabled: false,
      mediaServerTimeout: 30,
    }));

    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule],
      declarations: [RecommendedComponent, MockConfirmModalComponent],
      providers: [
        { provide: PlexService, useValue: plexService },
        { provide: JellyfinService, useValue: jellyfinService },
        { provide: EmbyService, useValue: embyService },
        { provide: LibraryService, useValue: libraryService },
        { provide: RecommendationService, useValue: recommendationService },
        { provide: PreferencesService, useValue: preferencesService },
        { provide: ExportService, useValue: exportService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RecommendedComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect Plex as active source and load movie libraries', fakeAsync(() => {
    plexService.getActiveServer.and.returnValue(of({
      server: 'My Plex',
      token: 'tok',
      libraries: [
        { title: 'Movies', type: 'movie' },
        { title: 'TV', type: 'show' },
      ],
    }));

    fixture.detectChanges();
    tick();

    expect(component.hasServer).toBeTrue();
    expect(component.activeSource).toBe('plex');
    expect(component.activeServerName).toBe('My Plex');
    expect(component.libraries.length).toBe(1);
    expect(component.libraries[0].title).toBe('Movies');
    expect(component.loading).toBeFalse();
  }));

  it('should detect Emby when Plex is not connected', fakeAsync(() => {
    embyService.getActiveServer.and.returnValue(of({
      server: 'My Emby',
      token: '',
      libraries: [{ title: 'Films', type: 'movie' }],
    }));

    fixture.detectChanges();
    tick();

    expect(component.activeSource).toBe('emby');
    expect(component.activeServerName).toBe('My Emby');
  }));

  it('should auto-select default library from preferences', fakeAsync(() => {
    preferencesService.load.and.returnValue(of({
      defaultLibrary: 'Movies',
      moviesPerPage: 25,
      hideOwnedByDefault: true,
      hideFutureReleasesByDefault: false,
      language: 'en',
      port: 4277,
      autoOpenBrowser: true,
      posterPrefetch: false,
      imageCacheEnabled: false,
      mediaServerTimeout: 30,
    }));
    plexService.getActiveServer.and.returnValue(of({
      server: 'Plex',
      token: 'tok',
      libraries: [{ title: 'Movies', type: 'movie' }],
    }));
    libraryService.getMovies.and.returnValue(of({ movies: [] }));

    fixture.detectChanges();
    tick();

    expect(component.selectedLibrary).toBe('Movies');
    expect(component.moviesPerPage).toBe(25);
    expect(component.showOwned).toBeFalse(); // hideOwnedByDefault = true
  }));

  it('should load movies when a library is selected', fakeAsync(() => {
    plexService.getActiveServer.and.returnValue(of({
      server: 'Plex', token: 'tok',
      libraries: [{ title: 'Movies', type: 'movie' }],
    }));
    fixture.detectChanges();
    tick();

    const mockMovies = [
      { name: 'Alien', year: 1979, overview: '', posterUrl: '', tmdbId: 348 },
      { name: 'Aliens', year: 1986, overview: '', posterUrl: '', tmdbId: 679 },
    ];
    libraryService.getMovies.and.returnValue(of({ movies: mockMovies } as any));

    component.selectedLibrary = 'Movies';
    component.selectedLibraries = ['Movies'];
    component.onLibrarySelect();
    tick();

    expect(component.movies.length).toBe(2);
    expect(component.loadingMovies).toBeFalse();
  }));

  it('filteredMovies should filter by movieFilter text', fakeAsync(() => {
    component.movies = [
      { name: 'Alien', year: 1979, overview: '', posterUrl: '' },
      { name: 'The Matrix', year: 1999, overview: '', posterUrl: '' },
    ];

    component.movieFilter = 'alien';
    expect(component.filteredMovies.length).toBe(1);
    expect(component.filteredMovies[0].name).toBe('Alien');

    component.movieFilter = '';
    expect(component.filteredMovies.length).toBe(2);
  }));

  it('pagedMovies should respect moviesPerPage and currentPage', () => {
    component.movies = Array.from({ length: 75 }, (_, i) => ({
      name: `Movie ${i}`, year: 2000, overview: '', posterUrl: '',
    }));
    component.moviesPerPage = 50;
    component.currentPage = 1;

    expect(component.pagedMovies.length).toBe(50);
    expect(component.totalPages).toBe(2);

    component.currentPage = 2;
    expect(component.pagedMovies.length).toBe(25);
  });

  it('applyFilter should group gaps by collection and filter owned/ignored', () => {
    const gaps: CollectionGap[] = [
      { tmdbId: 1, name: 'Alien', year: '1979', posterUrl: null, overview: '', collectionName: 'Alien Collection', owned: true },
      { tmdbId: 2, name: 'Aliens', year: '1986', posterUrl: null, overview: '', collectionName: 'Alien Collection', owned: false },
      { tmdbId: 3, name: 'Matrix', year: '1999', posterUrl: null, overview: '', collectionName: 'Matrix Collection', owned: false },
    ];
    component.allGaps = gaps;
    component.showOwned = false;
    component.showIgnored = false;
    component.ignoredIds = new Set();

    component.applyFilter();

    // Without owned, should have 2 gaps in 2 groups
    expect(component.collectionGroups.length).toBe(2);
    expect(component.missingCount).toBe(2);

    // With owned
    component.showOwned = true;
    component.applyFilter();
    expect(component.collectionGroups.length).toBe(2);
    const alienGroup = component.collectionGroups.find(g => g.name === 'Alien Collection');
    expect(alienGroup?.gaps.length).toBe(2);
  });

  it('applyFilter should hide ignored movies when showIgnored is false', () => {
    component.allGaps = [
      { tmdbId: 1, name: 'Movie A', year: '2020', posterUrl: null, overview: '', collectionName: 'Coll', owned: false },
      { tmdbId: 2, name: 'Movie B', year: '2021', posterUrl: null, overview: '', collectionName: 'Coll', owned: false },
    ];
    component.ignoredIds = new Set([1]);
    component.showOwned = true;
    component.showIgnored = false;

    component.applyFilter();

    expect(component.filteredGroups.length).toBe(1);
    expect(component.filteredGroups[0].gaps.length).toBe(1);
    expect(component.filteredGroups[0].gaps[0].tmdbId).toBe(2);
  });

  it('applyFilter should hide future releases when hideFutureReleases is true', () => {
    const future = '2099-12-31';
    const past = '1999-01-01';
    component.allGaps = [
      { tmdbId: 1, name: 'Released', year: '1999', releaseDate: past, posterUrl: null, overview: '', collectionName: 'C', owned: false },
      { tmdbId: 2, name: 'Future', year: '2099', releaseDate: future, posterUrl: null, overview: '', collectionName: 'C', owned: false },
      { tmdbId: 3, name: 'Unannounced', year: 'N/A', releaseDate: '', posterUrl: null, overview: '', collectionName: 'C', owned: false },
      { tmdbId: 4, name: 'Owned future', year: '2099', releaseDate: future, posterUrl: null, overview: '', collectionName: 'C', owned: true },
    ];
    component.ignoredIds = new Set();
    component.showOwned = true;
    component.showIgnored = true;
    component.hideFutureReleases = true;

    component.applyFilter();

    const titles = component.filteredGroups.flatMap(g => g.gaps.map(x => x.name));
    expect(titles).toContain('Released');
    expect(titles).toContain('Owned future'); // owned items are kept even if future
    expect(titles).not.toContain('Future');
    expect(titles).not.toContain('Unannounced'); // missing releaseDate is treated as future
    expect(component.missingCount).toBe(1); // only "Released" counts as missing
  });

  it('toggleIgnore should add/remove from ignored set', () => {
    const gap: CollectionGap = { tmdbId: 42, name: 'Test', year: '2020', posterUrl: null, overview: '', collectionName: 'C', owned: false };
    component.allGaps = [gap];
    component.ignoredIds = new Set();
    recommendationService.addIgnored.and.returnValue(of({}));
    recommendationService.removeIgnored.and.returnValue(of({}));

    const event = new Event('click');
    component.toggleIgnore(gap, event);
    expect(component.ignoredIds.has(42)).toBeTrue();

    component.toggleIgnore(gap, event);
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
    component.selectedMovie = { name: 'Test', year: 2020, overview: '', posterUrl: '' };
    component.scanMode = true;
    component.allGaps = [{ tmdbId: 1, name: 'X', year: '2020', posterUrl: null, overview: '', collectionName: 'C', owned: false }];
    component.errorMessage = 'some error';

    component.clearResults();

    expect(component.selectedMovie).toBeNull();
    expect(component.scanMode).toBeFalse();
    expect(component.allGaps).toEqual([]);
    expect(component.collectionGroups).toEqual([]);
    expect(component.errorMessage).toBe('');
  });

  it('scanLibrary with freshScan=true should show confirmation first', () => {
    component.scanLibrary(true);
    expect(component.showFreshScanConfirm).toBeTrue();
  });

  it('onFreshScanCancel should dismiss the confirmation', () => {
    component.showFreshScanConfirm = true;
    component.onFreshScanCancel();
    expect(component.showFreshScanConfirm).toBeFalse();
  });

  it('searchFilter should filter collection groups by name or movie name', () => {
    component.allGaps = [
      { tmdbId: 1, name: 'Alien', year: '1979', posterUrl: null, overview: '', collectionName: 'Alien Collection', owned: false },
      { tmdbId: 2, name: 'The Matrix', year: '1999', posterUrl: null, overview: '', collectionName: 'Matrix Collection', owned: false },
    ];
    component.showOwned = true;
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
      gaps: [{ tmdbId: 1, name: 'Movie', year: '2020', posterUrl: null, overview: '', collectionName: 'Coll', owned: false }],
    }];

    component.exportResults('csv');
    expect(exportService.exportGaps).toHaveBeenCalledWith(
      component.filteredGroups[0].gaps,
      'csv'
    );
  });

  it('should stop polling on destroy', () => {
    (component as any).pollTimer = setInterval(() => {}, 1000);
    component.ngOnDestroy();
    expect((component as any).pollTimer).toBeNull();
  });
});
