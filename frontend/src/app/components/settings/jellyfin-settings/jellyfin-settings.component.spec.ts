import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { JellyfinSettingsComponent } from './jellyfin-settings.component';
import { environment } from '../../../../environments/environment';

describe('JellyfinSettingsComponent', () => {
  let component: JellyfinSettingsComponent;
  let fixture: ComponentFixture<JellyfinSettingsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [JellyfinSettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(JellyfinSettingsComponent);
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

    const req = httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`);
    req.flush({
      server: 'My Jellyfin',
      libraries: [{ title: 'Films', type: 'movie' }],
    });
    tick();

    expect(component.hasActiveServer).toBeTrue();
    expect(component.activeServer).toBe('My Jellyfin');
    expect(component.activeLibraries.length).toBe(1);
  }));

  it('connect should not proceed with empty credentials', () => {
    component.serverUrl = '';
    component.apiKey = '';
    component.connect();
    expect(component.step).toBe('idle');
  });

  it('connect should call API and update state on success', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});

    component.serverUrl = 'http://jellyfin:8096';
    component.apiKey = 'key123';
    component.connect();
    expect(component.step).toBe('connecting');

    const req = httpMock.expectOne(`${environment.apiUrl}/jellyfin/connect`);
    expect(req.request.body).toEqual({ serverUrl: 'http://jellyfin:8096', apiKey: 'key123' });
    req.flush({
      connected: true,
      serverName: 'JellyServer',
      libraries: [{ title: 'Movies', type: 'movie', id: '1' }],
    });
    tick();

    expect(component.step).toBe('connected');
    expect(component.serverName).toBe('JellyServer');
    expect(component.libraries.length).toBe(1);
  }));

  it('connect should show error on failed connection', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});

    component.serverUrl = 'http://bad';
    component.apiKey = 'key';
    component.connect();

    const req = httpMock.expectOne(`${environment.apiUrl}/jellyfin/connect`);
    req.flush({ connected: false, serverName: '', libraries: [], error: 'Connection refused' });
    tick();

    expect(component.step).toBe('idle');
    expect(component.statusMessage).toBe('Connection refused');
    expect(component.statusType).toBe('error');
  }));

  it('save should call save API and reload active server', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});

    component.serverUrl = 'http://jellyfin:8096';
    component.apiKey = 'key';
    component.serverName = 'JellyServer';
    component.libraries = [{ title: 'Movies', type: 'movie' }];
    component.save();
    expect(component.step).toBe('saving');

    const saveReq = httpMock.expectOne(`${environment.apiUrl}/jellyfin/save`);
    saveReq.flush({ result: 'ok' });
    tick();

    // loadActiveServer fires again after save
    const reloadReq = httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`);
    reloadReq.flush({ server: 'JellyServer', libraries: [] });
    tick();

    expect(component.step).toBe('idle');
    expect(component.statusType).toBe('success');
  }));

  it('should filter movie libraries', () => {
    component.libraries = [
      { title: 'Movies', type: 'movie' },
      { title: 'TV', type: 'show' },
    ];
    expect(component.movieLibraries.length).toBe(1);
    expect(component.movieLibraries[0].title).toBe('Movies');
  });

  it('should toggle API key visibility', () => {
    expect(component.apiKeyVisible).toBeFalse();
    component.toggleApiKeyVisibility();
    expect(component.apiKeyVisible).toBeTrue();
  });

  it('removeServer should DELETE and reset state', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});

    component.hasActiveServer = true;
    component.removeServer();

    const req = httpMock.expectOne({
      method: 'DELETE',
      url: `${environment.apiUrl}/jellyfin/active-server`,
    });
    req.flush({ result: 'ok' });
    tick();

    expect(component.hasActiveServer).toBeFalse();
    expect(component.activeServer).toBe('');
    expect(component.statusType).toBe('success');
  }));

  it('testConnection should show success when connected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`).flush({});

    component.testConnection();
    expect(component.testing).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/jellyfin/test-active`);
    req.flush({ connected: true });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.statusMessage).toBe('Connection successful!');
  }));
});
