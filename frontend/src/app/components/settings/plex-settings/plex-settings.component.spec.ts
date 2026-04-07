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

  it('disconnect should clear active server state', () => {
    component.hasActiveServer = true;
    component.activeServer = 'Server';
    component.disconnect();

    expect(component.hasActiveServer).toBeFalse();
    expect(component.activeServer).toBe('');
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
});
