import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { RecommendedComponent } from './recommended.component';
import { RadarrDestinationComponent } from '../radarr-destination/radarr-destination.component';
import { SonarrDestinationComponent } from '../sonarr-destination/sonarr-destination.component';
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
import { CompactNumberPipe } from '../../pipes/compact-number.pipe';

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
    exportService.exportGaps.and.returnValue(Promise.resolve());
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
      imports: [HttpClientTestingModule, FormsModule, RouterTestingModule, RadarrDestinationComponent, SonarrDestinationComponent],
      declarations: [RecommendedComponent, MockConfirmModalComponent, CompactNumberPipe],
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

  it('offers a first scan, then a quick update after a completed scan with no gaps', fakeAsync(() => {
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'Plex', [
      { title: 'Movies', type: 'movie' }, { title: 'Other Movies', type: 'movie' },
    ])));
    libraryService.getMovies.and.returnValue(of({ movies: [{ name: 'Alien', year: 1979, posterUrl: null, overview: '' }] }));
    fixture.detectChanges();
    component.toggleLibrarySelection('Movies');
    fixture.detectChanges();
    const primary = () => fixture.nativeElement.querySelector('.scan-action button') as HTMLButtonElement;
    expect(primary().textContent).toContain('Scan for Gaps');
    expect(fixture.nativeElement.textContent).toContain('Your Movies');
    expect(fixture.nativeElement.textContent).not.toContain('Full Rescan');

    recommendationService.startScan.and.returnValue(of({ status: 'started', total: 1, mode: 'full' }));
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'done', processed: 1, total: 1, current_movie: '', collections_found: 0,
      gaps: [], total_owned: 1, libraries: ['Movies'], completed_at: '2026-09-24T12:00:00Z', error: null,
    }));
    primary().click();
    tick();
    fixture.detectChanges();
    expect(recommendationService.startScan).toHaveBeenCalledWith(['Movies'], true, false, 'plex', false);
    expect(primary().textContent).toContain('Check for New Gaps');
    expect(component.lastCheckedAt).toBe('2026-09-24T12:00:00Z');

    primary().click();
    tick();
    expect(recommendationService.startScan).toHaveBeenCalledWith(['Movies'], true, false, 'plex', true);
    component.clearResults();
    component.showScanResults();
    expect(component.scanMode).toBeTrue();
    expect(component.allGaps).toEqual([]);
    component.toggleLibrarySelection('Other Movies');
    fixture.detectChanges();
    expect(primary().textContent).toContain('Scan for Gaps');
    expect(component.lastCheckedAt).toBeNull();
    fixture.destroy();
  }));

  it('restores an empty completed scan and its quick-update action on page load', () => {
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'Plex', [{ title: 'Movies', type: 'movie' }])));
    libraryService.getMovies.and.returnValue(of({ movies: [] }));
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'done', processed: 1, total: 1, current_movie: '', collections_found: 0,
      gaps: [], total_owned: 1, libraries: ['Movies'], completed_at: '2026-09-24T12:00:00Z', error: null,
    }));
    fixture.detectChanges();
    expect(component.scanMode).toBeTrue();
    expect(component.canQuickUpdate).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Last checked');
    expect(fixture.nativeElement.textContent).toContain('No gaps found');
  });

  it('keeps TV scans full and disables the primary action while busy or unselected', () => {
    const scan = spyOn(component, 'scanLibrary');
    const update = spyOn(component, 'updateScan');
    component.runPrimaryScan();
    expect(scan).not.toHaveBeenCalled();
    component.mediaType = 'tv';
    component.selectedLibraries = ['TV'];
    (component as any).cacheCompletedScan(['TV'], [], 1);
    component.runPrimaryScan();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    component.loadingGaps = true;
    component.runPrimaryScan();
    component.toggleLibrarySelection('Other TV');
    expect(scan).toHaveBeenCalledTimes(1);
    expect(component.selectedLibraries).toEqual(['TV']);
  });

  it('loads the library when leaving results opened from a dashboard link', () => {
    dashboardLink('movie');
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'done', processed: 1, total: 1, current_movie: '', collections_found: 0,
      gaps: [], total_owned: 1, libraries: ['Movies'], completed_at: '2026-09-24T12:00:00Z', error: null,
    }));
    libraryService.getMovies.and.returnValue(of({ movies: [{ name: 'Alien', year: 1979, posterUrl: null, overview: '' }] }));
    fixture.detectChanges();
    component.browseLibrary();
    expect(component.scanMode).toBeFalse();
    expect(component.items[0].name).toBe('Alien');
    expect(component.canQuickUpdate).toBeTrue();
    component.showScanResults();
    expect(component.scanMode).toBeTrue();
    expect(recommendationService.startScan).not.toHaveBeenCalled();
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

  it('gives visible posters a head start and limits background loading to two at a time', fakeAsync(() => {
    const images: any[] = [];
    spyOn(window, 'Image').and.callFake(function () {
      const img = { src: '', onload: null, onerror: null, removeAttribute: jasmine.createSpy('removeAttribute') };
      images.push(img);
      return img as any;
    });
    component.posterPrefetch = true;
    component.itemsPerPage = 4;
    component.items = Array.from({ length: 8 }, (_, i) => ({ name: `Movie ${i}`, year: 2000, posterUrl: `/poster-${i}` }));
    component.prefetchNextPage();
    expect(images.length).toBe(0);
    tick(500);
    expect(images.length).toBe(2);
    expect(images.map(img => img.src)).toEqual(['/poster-4', '/poster-5']);
    expect(images[0].fetchPriority).toBe('low');
    images[0].onload();
    expect(images.length).toBe(3);
    const staleCompletion = images[1].onload;
    component.clearResults();
    expect(images[1].removeAttribute).toHaveBeenCalledWith('src');
    staleCompletion();
    expect(images.length).toBe(3);
    fixture.destroy();
  }));

  it('does not preload browse posters while scan results are being viewed', fakeAsync(() => {
    const createImage = spyOn(window, 'Image');
    component.posterPrefetch = true;
    component.itemsPerPage = 1;
    component.items = [
      { name: 'First', year: 2000, posterUrl: '/first' },
      { name: 'Next', year: 2001, posterUrl: '/next' },
    ];
    component.prefetchNextPage();
    component.scanMode = true;
    tick(500);
    expect(createImage).not.toHaveBeenCalled();
    fixture.destroy();
  }));

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
      gap({ id: 3, name: 'Unknown date', year: 'N/A', releaseDate: '', groupName: 'C', owned: false }),
      gap({ id: 4, name: 'Owned future', year: '2099', releaseDate: future, groupName: 'C', owned: true }),
      gap({ id: 5, name: 'Future year only', year: '2099', groupName: 'C', owned: false }),
      gap({ id: 6, name: 'Past year only', year: '1999', groupName: 'C', owned: false }),
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
    expect(titles).toContain('Unknown date');
    expect(titles).toContain('Past year only');
    expect(titles).not.toContain('Future year only');
    expect(component.missingCount).toBe(3);
  });

  it('toggleIgnore should request confirmation before ignoring an item', () => {
    const g = gap({ id: 42, name: 'Test', groupName: 'C', owned: false });
    component.allGaps = [g];
    component.ignoredIds = new Set();
    recommendationService.addIgnored.and.returnValue(of({}));

    const event = new Event('click');
    component.toggleIgnore(g, event);

    expect(component.pendingIgnoreGap).toBe(g);
    expect(component.ignoreConfirmationMessage).toContain('Test');
    expect(component.ignoredIds.has(42)).toBeFalse();
    expect(recommendationService.addIgnored).not.toHaveBeenCalled();

    component.onIgnoreConfirm();

    expect(component.pendingIgnoreGap).toBeNull();
    expect(component.ignoredIds.has(42)).toBeTrue();
    expect(recommendationService.addIgnored).toHaveBeenCalledWith(42);
  });

  it('onIgnoreCancel should leave the item unignored', () => {
    const g = gap({ id: 42, name: 'Test', groupName: 'C', owned: false });
    component.pendingIgnoreGap = g;
    component.ignoredIds = new Set();

    component.onIgnoreCancel();

    expect(component.pendingIgnoreGap).toBeNull();
    expect(component.ignoredIds.has(42)).toBeFalse();
    expect(recommendationService.addIgnored).not.toHaveBeenCalled();
  });

  it('toggleIgnore should unignore an ignored item without confirmation', () => {
    const g = gap({ id: 42, name: 'Test', groupName: 'C', owned: false });
    component.allGaps = [g];
    component.ignoredIds = new Set([42]);
    recommendationService.removeIgnored.and.returnValue(of({}));

    const event = new Event('click');
    component.toggleIgnore(g, event);

    expect(component.pendingIgnoreGap).toBeNull();
    expect(component.ignoredIds.has(42)).toBeFalse();
    expect(recommendationService.removeIgnored).toHaveBeenCalledWith(42);
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

  it('movie scans do not change scheduled notification thresholds', fakeAsync(() => {
    component.mediaType = 'movie';
    component.activeSource = 'plex';
    component.selectedLibraries = ['Movies'];
    component.minRating = 6.5;
    component.minVoteCount = 200;

    libraryService.getMovies.and.returnValue(of({ movies: [{ name: 'X', year: 2000, tmdbId: 1 }] } as any));
    recommendationService.startScan.and.returnValue(of({ status: 'started', total: 1 } as any));

    component.scanLibrary(false);
    tick();

    expect(preferencesService.save).not.toHaveBeenCalled();
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

  it('does not replace the latest library selection with a late browse response', () => {
    const pending = new Subject<any>();
    component.selectedLibraries = ['Old'];
    libraryService.getMovies.and.returnValue(pending);
    component.loadItems();
    libraryService.getMovies.and.returnValue(of({ movies: [{ name: 'New', tmdbId: 2 }] } as any));
    component.selectedLibraries = ['New'];
    component.loadItems();
    pending.next({ movies: [{ name: 'Old', tmdbId: 1 }] });
    expect(component.items.map(item => item.name)).toEqual(['New']);
  });

  it('ignores a movie lookup completed after switching to TV', () => {
    const pending = new Subject<any>();
    recommendationService.getGapsForMovie.and.returnValue(pending);
    component.selectItem({ name: 'Old movie', tmdbId: 1 } as any);
    component.setMediaType('tv');
    pending.next([{ name: 'Old movie', tmdbId: 1 }]);
    expect(component.allGaps).toEqual([]);
    expect(component.loadingGaps).toBeFalse();
  });

  it('stops a pending scan start when its view is cleared', () => {
    const pending = new Subject<any>();
    recommendationService.startScan.and.returnValue(pending);
    component.selectedLibraries = ['Movies'];
    component.scanLibrary();
    component.clearResults();
    pending.next({});
    expect(recommendationService.getScanProgress).not.toHaveBeenCalled();
    expect(component.loadingGaps).toBeFalse();
  });

  it('filters ratings immediately, preserves raw results, and keeps notifications separate', () => {
    fixture.detectChanges();
    component.allGaps = [
      gap({ id: 1, name: 'Low rating', tmdbRating: 5.9, tmdbVotes: 200 }),
      gap({ id: 2, name: 'Few votes', tmdbRating: 8, tmdbVotes: 109 }),
      gap({ id: 3, name: 'At threshold', tmdbRating: 6, tmdbVotes: 110 }),
      gap({ id: 4, name: 'Owned', owned: true, tmdbRating: 2, tmdbVotes: 2 }),
      gap({ id: 5, name: 'Future', releaseDate: '2099-01-01', tmdbRating: 0, tmdbVotes: 0 }),
      gap({ id: 6, name: 'Unknown rating' }),
    ];
    component.minRating = 6;
    component.minVoteCount = 110;
    component.onRatingFilterChange();
    expect(component.filteredGroups.flatMap(g => g.gaps.map(x => x.id))).toEqual([3, 4, 5, 6]);
    expect(component.ratingHiddenCount).toBe(2);
    expect(component.missingCount).toBe(3);
    expect(component.allGaps.length).toBe(6);
    expect(preferencesService.save).toHaveBeenCalledWith({ missingFilters: jasmine.objectContaining({ minRating: 6, minVoteCount: 110 }) });
    expect(recommendationService.startScan).not.toHaveBeenCalled();
    component.exportResults('csv');
    expect(exportService.exportGaps.calls.mostRecent().args[0].map(g => g.id)).toEqual([3, 4, 5, 6]);
    component.clearRatingFilter();
    expect(component.filteredGroups.flatMap(g => g.gaps).length).toBe(6);
    expect(component.ratingHiddenCount).toBe(0);
  });

  it('keeps result filters and Show all reachable when every title is hidden', () => {
    fixture.detectChanges();
    component.hasServer = true;
    component.scanMode = true;
    component.allGaps = [gap({ id: 1, name: 'Hidden title', tmdbRating: 2, tmdbVotes: 10 })];
    component.minRating = 6;
    component.onRatingFilterChange();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('1 title hidden');
    expect(fixture.nativeElement.querySelector('#recMinRating')).toBeTruthy();
    fixture.nativeElement.querySelector('.rating-filter-summary button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Hidden title');
    expect(component.ratingFilterActive).toBeFalse();
  });

  it('restores zero thresholds without re-enabling legacy limits, and ignores limits for TV', () => {
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES,
      qualityFilterEnabled: true, minRating: 6, minVoteCount: 110,
      missingFilters: { view: 'all', sortBy: 'default', genreFilter: null, showFuture: true, minRating: 0, minVoteCount: 0 },
    }));
    fixture.detectChanges();
    expect(component.minRating).toBe(0);
    expect(component.minVoteCount).toBe(0);
    component.mediaType = 'tv';
    component.minRating = 10;
    component.minVoteCount = 1000;
    component.allGaps = [gap({ id: 1, tmdbRating: 1, tmdbVotes: 1 })];
    component.applyFilter();
    expect(component.filteredGroups[0].gaps.length).toBe(1);
    expect(component.ratingHiddenCount).toBe(0);
  });

  it('distinguishes actual zero ratings from missing metadata in API results', () => {
    recommendationService.getGapsForMovie.and.returnValue(of([
      { tmdbId: 1, name: 'Unrated', year: '2000', voteAverage: 0, voteCount: 0 },
      { tmdbId: 2, name: 'Unknown', year: '2000' },
    ] as any));
    component.minRating = 6;
    component.minVoteCount = 110;
    component.selectItem({ name: 'Movie', year: 2000, posterUrl: null, tmdbId: 3 });
    expect(component.filteredGroups.flatMap(g => g.gaps.map(x => x.id))).toEqual([2]);
    expect(component.ratingHiddenCount).toBe(1);
    component.clearRatingFilter();
    expect(component.filteredGroups.flatMap(g => g.gaps).length).toBe(2);
  });

  it('reports polling failures instead of leaving a permanent spinner', fakeAsync(() => {
    recommendationService.getScanProgress.and.returnValue(throwError(() => new Error('offline')));
    component.loadingGaps = true;
    (component as any).startPolling(['Movies']);
    tick();
    expect(component.loadingGaps).toBeFalse();
    expect(component.errorMessage).toContain('Lost connection');
  }));

  it('does not restore a different servers scan for an identically named library', () => {
    component.activeServerName = 'Old server';
    (component as any).cacheCompletedScan(['Movies'], [gap({ id: 1, name: 'Old result' })], 1);
    component.activeServerName = 'New server';
    component.selectedLibraries = ['Movies'];
    libraryService.getMovies.and.returnValue(of({ movies: [] }));
    component.loadItems();
    expect(component.allGaps).toEqual([]);
    expect(component.scanMode).toBeFalse();
  });

  it('does not apply a remembered movie genre when opening TV', fakeAsync(() => {
    component.mediaType = 'tv';
    preferencesService.load.and.returnValue(of({ ...DEFAULT_PREFERENCES, missingFilters: {
      view: 'all', sortBy: 'default', genreFilter: 18, showFuture: true,
    } }));
    fixture.detectChanges();
    tick();
    expect(component.genreFilter).toBeNull();
  }));

  it('links saved TV titles without slugs to their TVDB ID', () => {
    component.mediaType = 'tv';
    tvdbService.getGapsForShow.and.returnValue(of([{ tvdbId: 123, name: 'TV title' }] as any));
    component.selectItem({ tvdbId: 123, name: 'TV title' } as any);
    expect(component.allGaps[0].externalUrl).toBe('https://thetvdb.com/dereferrer/series/123');
  });

  it('restores visible results when an ignore request fails', () => {
    const pending = new Subject<any>();
    recommendationService.addIgnored.and.returnValue(pending);
    const movie = gap({ id: 123, name: 'Movie', groupName: 'Collection' });
    component.allGaps = [movie];
    component.pendingIgnoreGap = movie;
    component.onIgnoreConfirm();
    expect(component.filteredGroups).toEqual([]);
    pending.error(new Error('offline'));
    expect(component.ignoredIds.has(123)).toBeFalse();
    expect(component.filteredGroups[0].gaps[0].id).toBe(123);
    expect(component.errorMessage).toContain('ignore');
  });

  it('does not apply a failed movie unignore to the TV ignore list', () => {
    const pending = new Subject<any>();
    recommendationService.removeIgnored.and.returnValue(pending);
    component.ignoredIds.add(123);
    component.toggleIgnore(gap({ id: 123 }), new Event('click'));
    component.setMediaType('tv');
    pending.error(new Error('offline'));
    expect(component.ignoredIds.has(123)).toBeFalse();
  });

  it('sends the result library context and destination to Radarr', () => {
    radarrService.getConfig.and.returnValue(of({ enabled: true } as any));
    radarrService.getLibraryTmdbIds.and.returnValue(of({ tmdb_ids: [] }));
    radarrService.addMovie.and.returnValue(of({ message: 'Added' }));
    component.refreshDownloaderStatus('radarr');
    component.activeSource = 'plex';
    component.activeServerName = 'Plex';
    component.downloaderLibraries = ['Movies'];
    component.selectedLibraries = ['Other'];
    component.radarrRootFolderPath = '/movies';
    component.sendToDownloader(gap({ id: 123, name: 'Test', year: 2020, radarrEligible: true }), new Event('click'));
    expect(radarrService.addMovie).toHaveBeenCalledWith(123, 'Test', 2020, {
      source: 'plex', server: 'Plex', library_names: ['Movies'], root_folder_path: '/movies',
    });
  });

  it('dismisses a movie ignore confirmation when switching to TV', () => {
    component.pendingIgnoreGap = gap({ id: 123 });
    component.setMediaType('tv');
    expect(component.pendingIgnoreGap).toBeNull();
    component.onIgnoreConfirm();
    expect(tvdbService.addIgnored).not.toHaveBeenCalled();
  });

  it('sends TV library context and a Sonarr destination without using the Radarr override', () => {
    component.setMediaType('tv');
    component.activeSource = 'plex';
    component.activeServerName = 'Plex';
    component.downloaderLibraries = ['TV'];
    component.sonarrRootFolderPath = '/tv';
    component.radarrRootFolderPath = '/movies';
    sonarrService.getConfig.and.returnValue(of({ enabled: true } as any));
    sonarrService.getLibraryTvdbIds.and.returnValue(of({ tvdb_ids: [] }));
    sonarrService.addSeries.and.returnValue(of({ message: 'Added' }));
    component.refreshDownloaderStatus('sonarr');
    component.sendToDownloader(gap({ id: 123, name: 'Test show', sonarrEligible: true }), new Event('click'));
    expect(sonarrService.addSeries).toHaveBeenCalledWith(123, 'Test show', {
      source: 'plex', server: 'Plex', library_names: ['TV'], root_folder_path: '/tv',
    });
    expect(radarrService.addMovie).not.toHaveBeenCalled();
    component.setMediaType('movie');
    expect(component.sonarrRootFolderPath).toBe('');
    expect(component.radarrRootFolderPath).toBe('');
    expect(component.downloaderLibraries).toEqual([]);
  });
  function dashboardLink(type: 'movie' | 'tv'): void {
    const router = TestBed.inject(Router);
    const url = router.parseUrl(`/recommended?latest=1&type=${type}`);
    spyOn(router, 'parseUrl').and.returnValue(url);
    activeServerService.getActive.and.returnValue(of(activeServer('plex', 'Plex', [
      { title: 'Movies', type: 'movie' }, { title: 'Shows', type: 'show' },
    ])));
  }

  it('opens the latest TV scan from the dashboard in the Missing filter', () => {
    dashboardLink('tv');
    tvdbService.getScanProgress.and.returnValue(of({
      status: 'done', phase: 'titles', processed: 10, total: 10, current_show: '', franchises_found: 1,
      gaps: [{ tvdbId: 42, name: 'Missing Show', year: 2025, posterUrl: null, overview: '', slug: '', franchiseName: 'Series', owned: false }],
      total_owned: 10, libraries: ['Shows'], completed_at: '2026-09-24T00:00:00Z', error: null,
    }));
    fixture.detectChanges();
    expect(component.mediaType).toBe('tv');
    expect(component.view).toBe('missing');
    expect(component.allGaps[0].name).toBe('Missing Show');
    expect(component.selectedLibraries).toEqual(['Shows']);
    expect(component.downloaderLibraries).toEqual([]);
    expect(recommendationService.getScanProgress).not.toHaveBeenCalled();
  });

  it('replaces stale cached results with an empty completed dashboard scan', () => {
    dashboardLink('movie');
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'done', processed: 10, total: 10, current_movie: '', collections_found: 0,
      gaps: [], total_owned: 10, libraries: ['Movies'], completed_at: '2026-09-24T00:00:00Z', error: null,
    }));
    component.allGaps = [gap({ id: 1, name: 'Old results' })];
    component.activeServerName = 'Plex';
    (component as any).cacheCompletedScan(['Movies'], component.allGaps, 1);
    component.radarrRootFolderPath = '/old';
    (component as any).captureSavedScanParam();
    (component as any).loadContext(false);
    expect(component.allGaps).toEqual([]);
    expect(component.scanMode).toBeTrue();
    expect(component.totalOwned).toBe(10);
    expect(component.loadingGaps).toBeFalse();
    expect(component.radarrRootFolderPath).toBe('');
    expect(recommendationService.cancelScan).not.toHaveBeenCalled();
    libraryService.getMovies.and.returnValue(of({ movies: [] }));
    component.loadItems();
    expect(component.allGaps).toEqual([]);
  });

  it('attaches to a running dashboard scan without starting or cancelling another', fakeAsync(() => {
    dashboardLink('movie');
    recommendationService.getScanProgress.and.returnValue(of({
      status: 'scanning', processed: 5, total: 10, current_movie: 'Movie', collections_found: 1,
      gaps: [], total_owned: 10, libraries: ['Movies'], completed_at: null, error: null,
    }));
    fixture.detectChanges();
    tick();
    expect(component.loadingGaps).toBeTrue();
    expect(component.scanProgress?.percent).toBe(50);
    expect(recommendationService.startScan).not.toHaveBeenCalled();
    expect(recommendationService.cancelScan).not.toHaveBeenCalled();
    fixture.destroy();
  }));

  it('shows a useful message when the dashboard scan cannot be loaded', () => {
    dashboardLink('tv');
    tvdbService.getScanProgress.and.returnValue(throwError(() => new Error('offline')));
    fixture.detectChanges();
    expect(component.loadingGaps).toBeFalse();
    expect(component.errorMessage).toContain('Could not load the latest scan');
  });

});
