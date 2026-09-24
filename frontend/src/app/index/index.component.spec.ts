import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { IndexComponent } from './index.component';
import { environment } from '../../environments/environment';

describe('IndexComponent', () => {
  let component: IndexComponent;
  let fixture: ComponentFixture<IndexComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
      declarations: [IndexComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(IndexComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function flushInitRequests(options?: {
    tmdb?: { hasKey: boolean; apiKey?: string };
    radarr?: any;
    sonarr?: any;
    tvdb?: any;
    failedCheck?: string;
    disconnectedMedia?: boolean;
    plex?: any;
    jellyfin?: any;
    emby?: any;
    schedule?: any;
    scanHistory?: any;
  }) {
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`)
      .flush(options?.tmdb ?? { hasKey: false, apiKey: '' });
    httpMock.expectOne(`${environment.apiUrl}/plex/active-server`)
      .flush(options?.plex ?? {});
    httpMock.expectOne(`${environment.apiUrl}/jellyfin/active-server`)
      .flush(options?.jellyfin ?? {});
    httpMock.expectOne(`${environment.apiUrl}/emby/active-server`)
      .flush(options?.emby ?? {});
    for (const service of ['radarr', 'sonarr', 'tvdb'] as const) {
      httpMock.expectOne(`${environment.apiUrl}/${service}/config`)
        .flush(options?.[service] ?? { enabled: false });
    }
    const checks = ['tmdb/test-key', 'plex/test-active', 'jellyfin/test-active', 'emby/test-active', 'radarr/test', 'sonarr/test', 'tvdb/test'];
    for (const endpoint of checks) {
      for (const request of httpMock.match(`${environment.apiUrl}/${endpoint}`)) {
        if (options?.failedCheck === endpoint) {
          request.flush({}, { status: 503, statusText: 'Unavailable' });
        } else {
          request.flush({ connected: !options?.disconnectedMedia, message: 'OK' });
        }
      }
    }
    httpMock.expectOne(`${environment.apiUrl}/schedule`)
      .flush(options?.schedule ?? { enabled: false, preset: '', next_run: null, last_run: null, run_history: [], presets: {} });
    httpMock.expectOne(`${environment.apiUrl}/scan-history`)
      .flush(options?.scanHistory ?? { history: [], lastMovie: null, lastTv: null });
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts each connection in a checking state', () => {
    expect(component.checkingConnections).toBeTrue();
    expect(component.connectionAlerts).toEqual([]);
  });

  it('shows all five connected services in the strip without alerts', () => {
    flushInitRequests({
      tmdb: { hasKey: true, apiKey: 'test-key' },
      plex: { server: 'My Plex', libraries: [] },
      radarr: { enabled: true, url: 'http://radarr', api_key: '••••••' },
      sonarr: { enabled: true, url: 'http://sonarr', api_key: '••••••' },
      tvdb: { enabled: true, api_key: '••••••', pin: '' },
    });
    fixture.detectChanges();
    expect(component.connections.every(connection => connection.state === 'connected')).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.connection').length).toBe(5);
    expect(fixture.nativeElement.querySelectorAll('.connection-alert').length).toBe(0);
    expect(component.connections[1].detail).toBe('My Plex');
  });

  for (const [source, name] of [['plex', 'Plex'], ['jellyfin', 'Jellyfin'], ['emby', 'Emby']]) {
    it(`checks the active ${name} server and links to its settings`, () => {
      flushInitRequests({ [source]: { server: `My ${name}`, libraries: [] } });
      fixture.detectChanges();
      expect(component.connections[1].name).toBe(name);
      expect(component.connections[1].state).toBe('connected');
      expect(component.connections[1].settings).toBe(`/settings/${source}`);
      expect(fixture.nativeElement.querySelectorAll('.connection')[1].getAttribute('href')).toBe(`/settings/${source}`);
    });
  }

  it('prioritizes Plex when multiple media servers are saved', () => {
    flushInitRequests({ plex: { server: 'Plex' }, jellyfin: { server: 'Jellyfin' }, emby: { server: 'Emby' } });
    expect(component.connections[1].name).toBe('Plex');
  });

  it('keeps disabled optional services neutral and shows setup alerts for required services', () => {
    flushInitRequests();
    fixture.detectChanges();
    expect(component.connections.slice(2).every(connection => connection.state === 'disabled')).toBeTrue();
    expect(component.connectionAlerts.map(connection => connection.name)).toEqual(['TMDB', 'Media server']);
    expect(fixture.nativeElement.querySelectorAll('.connection-alert').length).toBe(2);
    expect(component.checkingConnections).toBeFalse();
  });

  it('warns about incomplete enabled integrations without testing their connections', () => {
    flushInitRequests({ radarr: { enabled: true, url: '', api_key: '' }, tvdb: { enabled: true, api_key: '' } });
    expect(component.connections[2].label).toBe('Setup needed');
    expect(component.connections[4].label).toBe('Setup needed');
    httpMock.expectNone(`${environment.apiUrl}/radarr/test`);
    httpMock.expectNone(`${environment.apiUrl}/tvdb/test`);
  });

  for (const [index, service] of [[0, 'tmdb'], [2, 'radarr'], [3, 'sonarr'], [4, 'tvdb']] as const) {
    it(`shows an alert when ${service} credentials or connection fail`, () => {
      flushInitRequests({
        tmdb: { hasKey: true, apiKey: 'test-key' },
        [service]: service === 'tmdb' ? { hasKey: true, apiKey: 'test-key' } : { enabled: true, url: 'http://service', api_key: '••••••' },
        failedCheck: service === 'tmdb' ? 'tmdb/test-key' : `${service}/test`,
      });
      expect(component.connections[index].state).toBe('attention');
      expect(component.connections[index].label).toBe('Check failed');
    });
  }

  it('does not mark a saved but unreachable media server connected', () => {
    flushInitRequests({ plex: { server: 'My Plex' }, disconnectedMedia: true });
    expect(component.connections[1].state).toBe('attention');
    expect(component.connections[1].detail).toContain('My Plex');
  });

  it('keeps scan summaries visible while checks are pending and allows retry after a timeout', fakeAsync(() => {
    flushInitRequests();
    component.checkConnections();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.last-scan-card')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.check-connections').disabled).toBeTrue();
    // Leave the network requests pending to exercise timeout handling.
    const pending = httpMock.match(() => true);
    tick(30000);
    fixture.detectChanges();
    expect(component.checkingConnections).toBeFalse();
    expect(pending.every(request => request.cancelled)).toBeTrue();
    expect(fixture.nativeElement.querySelector('.check-connections').disabled).toBeFalse();
    fixture.nativeElement.querySelector('.check-connections').click();
    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`).flush({ hasKey: false });
    for (const source of ['plex', 'jellyfin', 'emby']) {
      httpMock.expectOne(`${environment.apiUrl}/${source}/active-server`).flush({});
    }
    for (const source of ['radarr', 'sonarr', 'tvdb']) {
      httpMock.expectOne(`${environment.apiUrl}/${source}/config`).flush({ enabled: false });
    }
    expect(component.connections[2].state).toBe('disabled');
  }));

  it('cancels pending connection requests when leaving the dashboard', () => {
    fixture.detectChanges();
    const pending = httpMock.match(request => !request.url.endsWith('/schedule') && !request.url.endsWith('/scan-history'));
    httpMock.expectOne(`${environment.apiUrl}/schedule`).flush({});
    httpMock.expectOne(`${environment.apiUrl}/scan-history`).flush({});
    fixture.destroy();
    expect(pending.every(request => request.cancelled)).toBeTrue();
  });

  it('should load schedule status', fakeAsync(() => {
    flushInitRequests({
      schedule: { enabled: true, preset: 'daily', next_run: '2026-04-07T00:00:00Z', last_run: null, run_history: [], presets: {} },
    });
    tick();

    expect(component.scheduleEnabled).toBeTrue();
    expect(component.schedulePreset).toBe('daily');
    expect(component.nextRun).toBe('2026-04-07T00:00:00Z');
  }));

  it('should load latest movie and TV scan summaries', fakeAsync(() => {
    flushInitRequests({
      scanHistory: {
        history: [],
        lastMovie: {
          timestamp: '2026-05-20T10:00:00Z', mediaType: 'movie', libraries: ['Movies'],
          totalOwned: 500, missing: 42, status: 'success', trigger: 'manual', message: '',
        },
        lastTv: {
          timestamp: '2026-05-19T10:00:00Z', mediaType: 'tv', libraries: ['Shows'],
          totalOwned: 120, missing: 7, status: 'success', trigger: 'manual', message: '',
        },
      },
    });
    tick();

    expect(component.lastMovieScan?.missing).toBe(42);
    expect(component.lastMovieScan?.totalOwned).toBe(500);
    expect(component.lastTvScan?.missing).toBe(7);
    expect(component.lastTvScan?.totalOwned).toBe(120);
    expect(component.hasAnyLastScan).toBeTrue();
  }));

  it('navigates to /scan-history when card is clicked', fakeAsync(() => {
    flushInitRequests({
      scanHistory: {
        history: [],
        lastMovie: { timestamp: '2026-05-20T10:00:00Z', mediaType: 'movie', libraries: [], totalOwned: 1, missing: 1, status: 'success', trigger: 'manual', message: '' },
        lastTv: null,
      },
    });
    tick();

    const router = TestBed.inject(Router);
    const spy = spyOn(router, 'navigate');
    component.openHistory();

    expect(spy).toHaveBeenCalledWith(['/scan-history']);
  }));

  it('does not navigate when there is no scan history', fakeAsync(() => {
    flushInitRequests();
    tick();

    const router = TestBed.inject(Router);
    const spy = spyOn(router, 'navigate');
    component.openHistory();

    expect(spy).not.toHaveBeenCalled();
  }));
});
