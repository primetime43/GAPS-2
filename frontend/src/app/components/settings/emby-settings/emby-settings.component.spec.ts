import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { FormsModule } from '@angular/forms';
import { EmbySettingsComponent } from './emby-settings.component';
import { environment } from '../../../../environments/environment';

describe('EmbySettingsComponent', () => {
  let component: EmbySettingsComponent;
  let fixture: ComponentFixture<EmbySettingsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, FormsModule],
      declarations: [EmbySettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EmbySettingsComponent);
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

    const req = httpMock.expectOne(`${environment.apiUrl}/emby/active-server`);
    req.flush({
      server: 'My Emby',
      libraries: [{ title: 'Movies', type: 'movie' }, { title: 'Music', type: 'music' }],
    });
    tick();

    expect(component.hasActiveServer).toBeTrue();
    expect(component.activeServer).toBe('My Emby');
    expect(component.activeLibraries.length).toBe(2);
  }));

  it('connect should not proceed with empty credentials', () => {
    component.serverUrl = '';
    component.apiKey = '';
    component.connect();
    expect(component.step).toBe('idle');
  });

  it('connect should call API and update state on success', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.serverUrl = 'http://emby:8096';
    component.apiKey = 'key123';
    component.connect();
    expect(component.step).toBe('connecting');

    const req = httpMock.expectOne(`${environment.apiUrl}/emby/connect`);
    expect(req.request.body).toEqual({ serverUrl: 'http://emby:8096', apiKey: 'key123' });
    req.flush({
      connected: true,
      serverName: 'EmbyServer',
      libraries: [{ title: 'Films', type: 'movie', id: '1' }],
    });
    tick();

    expect(component.step).toBe('connected');
    expect(component.serverName).toBe('EmbyServer');
    expect(component.libraries.length).toBe(1);
  }));

  it('connect should show error on failed connection', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.serverUrl = 'http://bad';
    component.apiKey = 'key';
    component.connect();

    const req = httpMock.expectOne(`${environment.apiUrl}/emby/connect`);
    req.flush({ connected: false, serverName: '', libraries: [], error: 'Connection refused' });
    tick();

    expect(component.step).toBe('idle');
    expect(component.statusMessage).toBe('Connection refused');
    expect(component.statusType).toBe('error');
  }));

  it('save should call save API and reload active server', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.serverUrl = 'http://emby:8096';
    component.apiKey = 'key';
    component.serverName = 'EmbyServer';
    component.libraries = [{ title: 'Movies', type: 'movie' }];
    component.save();
    expect(component.step).toBe('saving');

    const saveReq = httpMock.expectOne(`${environment.apiUrl}/emby/save`);
    saveReq.flush({ result: 'ok' });
    tick();

    const reloadReq = httpMock.expectOne(`${environment.apiUrl}/emby/active-server`);
    reloadReq.flush({ server: 'EmbyServer', libraries: [] });
    tick();

    expect(component.step).toBe('idle');
    expect(component.statusType).toBe('success');
  }));

  it('should filter movie libraries', () => {
    component.libraries = [
      { title: 'Movies', type: 'movie' },
      { title: 'Music', type: 'music' },
    ];
    expect(component.movieLibraries.length).toBe(1);
    expect(component.movieLibraries[0].title).toBe('Movies');
  });

  it('should filter active movie vs other libraries', () => {
    component.activeLibraries = [
      { title: 'Movies', type: 'movie' },
      { title: 'TV', type: 'show' },
      { title: 'Anime', type: 'movie' },
    ];
    expect(component.activeMovieLibraries.length).toBe(2);
    expect(component.activeOtherLibraries.length).toBe(1);
  });

  it('should toggle API key visibility', () => {
    expect(component.apiKeyVisible).toBeFalse();
    component.toggleApiKeyVisibility();
    expect(component.apiKeyVisible).toBeTrue();
  });

  it('removeServer should DELETE and reset state', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.hasActiveServer = true;
    component.removeServer();

    const req = httpMock.expectOne({
      method: 'DELETE',
      url: `${environment.apiUrl}/emby/active-server`,
    });
    req.flush({ result: 'ok' });
    tick();

    expect(component.hasActiveServer).toBeFalse();
    expect(component.activeServer).toBe('');
    expect(component.statusType).toBe('success');
  }));

  it('testConnection should show success when connected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.testConnection();
    expect(component.testing).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/emby/test-active`);
    req.flush({ connected: true });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.statusMessage).toBe('Connection successful!');
  }));

  it('testConnection should show error when not connected', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`).flush({});

    component.testConnection();
    const req = httpMock.expectOne(`${environment.apiUrl}/emby/test-active`);
    req.flush({ connected: false, error: 'Timeout' });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.statusMessage).toBe('Timeout');
    expect(component.statusType).toBe('error');
  }));
});
