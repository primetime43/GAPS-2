import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { UserPreferencesSettingsComponent } from './user-preferences-settings.component';
import { environment } from '../../../../environments/environment';

describe('UserPreferencesSettingsComponent', () => {
  let component: UserPreferencesSettingsComponent;
  let fixture: ComponentFixture<UserPreferencesSettingsComponent>;
  let httpMock: HttpTestingController;

  const defaultPrefs = {
    defaultLibrary: '',
    moviesPerPage: 50,
    hideOwnedByDefault: false,
    language: 'en',
    port: 5000,
    autoOpenBrowser: true,
    posterPrefetch: false,
    imageCacheEnabled: false,
    mediaServerTimeout: 30,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [UserPreferencesSettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UserPreferencesSettingsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function initComponent() {
    fixture.detectChanges();
    // Respond to preferences load
    httpMock.expectOne(`${environment.apiUrl}/preferences`).flush(defaultPrefs);
    // Respond to media server checks
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load preferences on init and set loading to false', fakeAsync(() => {
    initComponent();
    tick();

    expect(component.loading).toBeFalse();
    expect(component.prefs.moviesPerPage).toBe(50);
    expect(component.prefs.language).toBe('en');
    expect(component.prefs.mediaServerTimeout).toBe(30);
  }));

  it('should populate libraries from active media server', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/preferences`).flush(defaultPrefs);
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({
      server: 'My Plex',
      libraries: [
        { title: 'Movies', type: 'movie' },
        { title: 'TV', type: 'show' },
      ],
    });
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});
    tick();

    // Only movie libraries should be included
    expect(component.libraries.length).toBe(1);
    expect(component.libraries[0].title).toBe('Movies');
  }));

  it('should save preferences and show success', fakeAsync(() => {
    initComponent();
    tick();

    component.prefs.moviesPerPage = 100;
    component.prefs.mediaServerTimeout = 60;
    component.save();

    expect(component.saving).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/preferences`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.moviesPerPage).toBe(100);
    expect(req.request.body.mediaServerTimeout).toBe(60);

    req.flush({ ...defaultPrefs, moviesPerPage: 100, mediaServerTimeout: 60 });
    tick();

    expect(component.saving).toBeFalse();
    expect(component.saved).toBeTrue();
    expect(component.prefs.moviesPerPage).toBe(100);
    expect(component.prefs.mediaServerTimeout).toBe(60);
  }));

  it('should have expected language options', () => {
    expect(component.languages.length).toBeGreaterThan(5);
    expect(component.languages.some(l => l.code === 'en' && l.name === 'English')).toBeTrue();
    expect(component.languages.some(l => l.code === 'fr' && l.name === 'French')).toBeTrue();
  });

  it('should have expected page size options', () => {
    expect(component.pageSizeOptions).toEqual([25, 50, 100, 200]);
  });

  it('should handle save error gracefully', fakeAsync(() => {
    initComponent();
    tick();

    component.save();

    const req = httpMock.expectOne(`${environment.apiUrl}/preferences`);
    req.error(new ProgressEvent('Network error'));
    tick();

    expect(component.saving).toBeFalse();
    expect(component.saved).toBeFalse();
  }));
});
