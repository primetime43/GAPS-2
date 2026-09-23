import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { PlexSettingsComponent } from './plex-settings.component';
import { environment } from '../../../../environments/environment';

describe('PlexSettingsComponent', () => {
  let component: PlexSettingsComponent;
  let fixture: ComponentFixture<PlexSettingsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [PlexSettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PlexSettingsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load active server on init', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(`${environment.apiUrl}/plex/active-server`);
    req.flush({
      server: 'My Plex',
      token: 'tok123',
      libraries: [{ title: 'Movies', type: 'movie' }, { title: 'TV', type: 'show' }],
    });
    tick();

    expect(component.hasActiveServer).toBeTrue();
    expect(component.activeServer).toBe('My Plex');
    expect(component.activeLibraries.length).toBe(2);
    expect(component.plexToken).toBe('tok123');
  }));

  it('should start with idle step and choose connection mode', () => {
    expect(component.step).toBe('idle');
    expect(component.connectionMode).toBe('choose');
  });

  it('should filter movie libraries from all libraries', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});

    component.libraries = [
      { title: 'Movies', type: 'movie' },
      { title: 'TV Shows', type: 'show' },
      { title: 'Anime', type: 'movie' },
    ];

    expect(component.movieLibraries.length).toBe(2);
    expect(component.movieLibraries.map(l => l.title)).toEqual(['Movies', 'Anime']);
  }));

  it('isLoading should return true for loading steps', () => {
    component.step = 'authenticating';
    expect(component.isLoading).toBeTrue();
    component.step = 'fetching';
    expect(component.isLoading).toBeTrue();
    component.step = 'saving';
    expect(component.isLoading).toBeTrue();
    component.step = 'manual-connecting';
    expect(component.isLoading).toBeTrue();
    component.step = 'idle';
    expect(component.isLoading).toBeFalse();
    component.step = 'selecting';
    expect(component.isLoading).toBeFalse();
  });

  it('should toggle token visibility', () => {
    expect(component.tokenVisible).toBeFalse();
    component.togglePlexTokenVisibility();
    expect(component.tokenVisible).toBeTrue();
    component.togglePlexTokenVisibility();
    expect(component.tokenVisible).toBeFalse();
  });

  it('changing servers keeps the saved server available for cancellation', () => {
    component.hasActiveServer = true;
    component.activeServer = 'Server';
    component.disconnect();

    expect(component.hasActiveServer).toBeFalse();
    expect(component.activeServer).toBe('Server');
    expect(component.step).toBe('idle');
    expect(component.connectionMode).toBe('choose');
  });

  it('removeServer should call DELETE and reset state on success', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});

    component.hasActiveServer = true;
    component.activeServer = 'Server';
    component.removeServer();

    const req = httpMock.expectOne({
      method: 'DELETE',
      url: `${environment.apiUrl}/plex/active-server`,
    });
    req.flush({ result: 'ok' });
    tick();

    expect(component.hasActiveServer).toBeFalse();
    expect(component.activeServer).toBe('');
    expect(component.statusType).toBe('success');
  }));

  it('testConnection should POST and show success when connected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});

    component.testConnection();
    expect(component.testing).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/plex/test-active`);
    expect(req.request.method).toBe('POST');
    req.flush({ connected: true, serverName: 'My Plex' });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.statusMessage).toBe('Connection successful!');
    expect(component.statusType).toBe('success');
  }));

  it('testConnection should show error when not connected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});

    component.testConnection();
    const req = httpMock.expectOne(`${environment.apiUrl}/plex/test-active`);
    req.flush({ connected: false, error: 'Server unreachable' });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.statusMessage).toBe('Server unreachable');
    expect(component.statusType).toBe('error');
  }));

  for (const mode of ['oauth', 'manual'] as const) {
    it(`shows movie, TV and other libraries during ${mode} linking`, () => {
      fixture.detectChanges();
      httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});
      component.connectionMode = mode;
      component.step = mode === 'oauth' ? 'selecting' : 'manual-connected';
      component.librariesLoaded = true;
      component.libraries = [
        { title: 'Cinema', type: 'movie' }, { title: 'Series', type: 'show' },
        { title: 'Music', type: 'artist' },
      ];
      fixture.detectChanges();
      const preview = fixture.nativeElement.querySelector('.library-preview');
      expect(preview.textContent).toContain('Movie libraries (1)');
      expect(preview.textContent).toContain('TV libraries (1)');
      expect(preview.querySelector('.lib-tag-tv').textContent).toContain('Series');
      expect(preview.textContent).toContain('Music (artist)');
      expect(preview.textContent).toContain('Other library types are listed for reference');
    });
  }

  it('allows saving a TV-only server and uses the selected connection', () => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});
    component.connectionMode = 'oauth';
    component.step = 'selecting';
    component.selectedServer = 'NAS';
    component.selectedConnectionUrl = 'http://nas:32400';
    component.connectToServer();
    const connect = httpMock.expectOne(req => req.url.endsWith('/plex/libraries/NAS'));
    expect(connect.request.params.get('serverUrl')).toBe('http://nas:32400');
    const libraries = [{ title: 'Series', type: 'show' }];
    connect.flush({ libraries, token: 'token', connections: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.lib-tag-tv').textContent).toContain('Series');
    expect(fixture.nativeElement.querySelector('.btn-success')).toBeTruthy();
    component.setAsActive();
    const save = httpMock.expectOne(`${environment.apiUrl}/plex/save-data`);
    expect(save.request.body).toEqual({ server: 'NAS', token: 'token', libraries, serverUrl: 'http://nas:32400' });
    save.flush({ result: 'Success' });
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({ server: 'NAS', libraries });
  });

  it('clears the preview and blocks saving after changing connection or a failed retry', () => {
    component.selectedServer = 'NAS';
    component.plexToken = 'token';
    component.libraries = [{ title: 'Old TV', type: 'show' }];
    component.librariesLoaded = true;
    component.onConnectionChange();
    component.setAsActive();
    expect(component.libraries).toEqual([]);
    httpMock.expectNone(`${environment.apiUrl}/plex/save-data`);
    component.connectToServer();
    httpMock.expectOne(`${environment.apiUrl}/plex/libraries/NAS`).flush({ error: 'Offline' }, { status: 404, statusText: 'Not found' });
    expect(component.librariesLoaded).toBeFalse();
    expect(component.statusMessage).toBe('Offline');
  });

  it('shows an explicit empty-library state after connecting', () => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});
    component.connectionMode = 'manual';
    component.manualServerUrl = 'http://nas:32400';
    component.manualToken = 'token';
    component.connectManual();
    httpMock.expectOne(`${environment.apiUrl}/plex/connect-manual`).flush({ connected: true, serverName: 'NAS', libraries: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.library-preview').textContent).toContain('Plex returned no libraries');
  });

  it('refreshes saved TV libraries without signing in again and keeps them on failure', () => {
    component.refreshLibraries();
    const libraries = [{ title: 'New Series', type: 'show' }];
    httpMock.expectOne(`${environment.apiUrl}/plex/refresh`).flush({ connected: true, libraries });
    expect(component.activeTvLibraries).toEqual(libraries);
    expect(component.refreshing).toBeFalse();
    component.refreshLibraries();
    httpMock.expectOne(`${environment.apiUrl}/plex/refresh`).flush({ connected: false, error: 'Offline' });
    expect(component.activeTvLibraries).toEqual(libraries);
    expect(component.statusMessage).toBe('Offline');
  });

  it('offers a sign-in link and cancels pending login checks', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({});
    spyOn(window, 'open').and.returnValue(null);
    component.connectionMode = 'oauth';
    component.connectPlex();
    httpMock.expectOne(`${environment.apiUrl}/plex/authenticate`).flush({ oauth_url: 'https://app.plex.tv/auth' });
    const check = httpMock.expectOne(`${environment.apiUrl}/plex/check-login`);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[rel="noopener noreferrer"]').textContent).toContain('Open Plex sign-in');
    component.cancelSetup();
    expect(check.cancelled).toBeTrue();
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`).flush({ server: 'Saved NAS', libraries: [] });
    tick(2000);
    httpMock.expectNone(`${environment.apiUrl}/plex/check-login`);
    expect(component.hasActiveServer).toBeTrue();
    expect(component.activeServer).toBe('Saved NAS');
  }));

  it('stops polling when the component is destroyed', fakeAsync(() => {
    spyOn(window, 'open').and.returnValue(null);
    component.connectPlex();
    httpMock.expectOne(`${environment.apiUrl}/plex/authenticate`).flush({ oauth_url: 'https://app.plex.tv/auth' });
    httpMock.expectOne(`${environment.apiUrl}/plex/check-login`).flush({ authenticated: false });
    fixture.destroy();
    tick(2000);
    httpMock.expectNone(`${environment.apiUrl}/plex/check-login`);
  }));

  it('returns to the chooser when authentication fails', () => {
    component.connectionMode = 'oauth';
    component.connectPlex();
    httpMock.expectOne(`${environment.apiUrl}/plex/authenticate`).flush({}, { status: 500, statusText: 'Error' });
    expect(component.connectionMode).toBe('choose');
    expect(component.step).toBe('idle');
  });
});
