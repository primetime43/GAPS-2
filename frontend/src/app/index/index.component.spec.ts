import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
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
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`)
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
    expect(fixture.nativeElement.querySelector('.activity-card')).toBeTruthy();
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
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`).flush({});
    fixture.destroy();
    expect(pending.every(request => request.cancelled)).toBeTrue();
  });

  function scheduledRun(mediaType: 'movie' | 'tv', timestamp: string, missing: number, status = 'success') {
    return { mediaType, timestamp, missing, status, library: '', collections: 1, message: '' };
  }

  it('shows independent schedules and converts offset timestamps to browser local time', () => {
    const movieTime = new Date(2026, 9, 1, 4).toISOString();
    const tvTime = new Date(2026, 9, 2, 18, 30).toISOString();
    flushInitRequests({ schedule: {
      movie: { enabled: true, preset: 'monthly', next_run: movieTime.replace('T', ' '), libraries: ['Films'] },
      tv: { enabled: true, preset: 'weekly', next_run: tvTime, libraries: ['Shows'] },
      // Legacy combined fields must not choose the displayed schedule.
      enabled: true, description: 'Combined server time', next_run: 'wrong', run_history: [],
    } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.schedule-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Movies');
    expect(rows[0].textContent).toContain('Monthly');
    expect(rows[0].textContent).toContain('Next run: Oct 1 at 4:00 AM');
    expect(rows[0].textContent).toContain('Films');
    expect(rows[1].textContent).toContain('TV Shows');
    expect(rows[1].textContent).toContain('Next run: Oct 2 at 6:30 PM');
    expect(rows[1].textContent).toContain('Shows');
    expect(fixture.nativeElement.querySelector('.schedule-card').textContent).not.toContain('Combined server time');
  });

  it('matches the latest scheduled run to each media type, independent of history order', () => {
    const movie = scheduledRun('movie', new Date(2026, 8, 1, 4).toISOString(), 334);
    const tv = scheduledRun('tv', new Date(2026, 8, 2, 5).toISOString(), 188);
    flushInitRequests({ schedule: {
      movie: { enabled: true, preset: 'monthly', next_run: null },
      tv: { enabled: true, preset: 'weekly', next_run: null },
      last_run: tv,
      run_history: [scheduledRun('movie', '2026-08-01T00:00:00Z', 1), tv, movie],
    } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.schedule-row');
    expect(rows[0].textContent).toContain('Last scheduled run: Sep 1 at 4:00 AM');
    expect(rows[0].textContent).toContain('334');
    expect(rows[0].textContent).not.toContain('188');
    expect(rows[1].textContent).toContain('Last scheduled run: Sep 2 at 5:00 AM');
    expect(rows[1].textContent).toContain('188');
    expect(rows[1].textContent).not.toContain('334');
  });

  it('shows disabled schedules and does not attribute legacy movie history to TV', () => {
    flushInitRequests({ schedule: {
      movie: { enabled: false }, tv: { enabled: false }, run_history: [],
      last_run: { timestamp: '2026-09-01T00:00:00Z', missing: 12, status: 'success' },
    } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.schedule-row');
    expect(rows[0].textContent).toContain('Not scheduled');
    expect(rows[0].textContent).toContain('12');
    expect(rows[1].textContent).toContain('Not scheduled');
    expect(rows[1].textContent).toContain('No recent scheduled runs');
    expect(fixture.nativeElement.querySelectorAll('.schedule-next').length).toBe(0);
  });

  it('handles missing next-run times and keeps failed and skipped run details separate', () => {
    flushInitRequests({ schedule: {
      movie: { enabled: true, next_run: null }, tv: { enabled: true, next_run: 'invalid' },
      run_history: [
        { ...scheduledRun('movie', '2026-09-01T00:00:00Z', 0, 'error'), message: 'Movie server unavailable' },
        { ...scheduledRun('tv', '2026-09-02T00:00:00Z', 0, 'skipped'), message: 'TheTVDB not configured' },
      ],
    } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.schedule-row');
    expect(rows[0].textContent).toContain('Next run: Unavailable');
    expect(rows[0].textContent).toContain('failed.');
    expect(rows[0].textContent).toContain('Movie server unavailable');
    expect(rows[1].textContent).toContain('Next run: Unavailable');
    expect(rows[1].textContent).toContain('skipped.');
    expect(rows[1].textContent).toContain('TheTVDB not configured');
  });

  it('reports a schedule request failure instead of displaying schedules as disabled, and retries', () => {
    flushInitRequests();
    component.loadSchedules();
    httpMock.expectOne(`${environment.apiUrl}/schedule`).flush({}, { status: 503, statusText: 'Offline' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.schedule-row').length).toBe(0);
    expect(fixture.nativeElement.querySelector('.schedule-error').textContent).toContain('Could not load schedules');
    fixture.nativeElement.querySelector('.schedule-error button').click();
    httpMock.expectOne(`${environment.apiUrl}/schedule`).flush({ movie: { enabled: false }, tv: { enabled: false } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.schedule-row').length).toBe(2);
  });

  it('refreshes schedules as well as scan summaries after a scan finishes', () => {
    flushInitRequests();
    component.refreshScanSummaries();
    httpMock.expectOne(`${environment.apiUrl}/schedule`).flush({
      movie: { enabled: true, preset: 'daily', next_run: new Date(2026, 9, 2, 4).toISOString() },
      tv: { enabled: false },
    });
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`).flush({ lastMovie: null, lastTv: null });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.schedule-row').textContent).toContain('Oct 2 at 4:00 AM');
  });

  function activity(overrides: any = {}) {
    return {
      id: 'scan-1', timestamp: new Date(2026, 8, 24, 4).toISOString(), mediaType: 'movie',
      libraries: ['Films'], totalOwned: 500, missing: 42, status: 'success', trigger: 'manual', message: '',
      ...overrides,
    };
  }

  it('shows at most three recent scans in the existing card with libraries and local dates', () => {
    flushInitRequests({ scanHistory: { history: [
      activity(),
      activity({ id: 'scan-2', mediaType: 'tv', libraries: ['Shows', 'Kids TV'], missing: 7, trigger: 'scheduled' }),
      activity({ id: 'scan-3', libraries: ['Classics'], missing: 0 }),
      activity({ id: 'scan-4', libraries: ['Older scan'] }),
    ] } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.activity-row');
    expect(rows.length).toBe(3);
    expect(rows[0].textContent).toContain('Movies');
    expect(rows[0].textContent).toContain('Films');
    expect(rows[0].textContent).toContain('42 missing');
    expect(rows[0].textContent).toContain('Completed');
    expect(rows[0].textContent).toContain('Sep 24 at 4:00 AM');
    expect(rows[1].textContent).toContain('TV');
    expect(rows[1].textContent).toContain('Shows, Kids TV');
    expect(rows[1].textContent).toContain('7 missing');
    expect(rows[2].textContent).toContain('0 missing');
    expect(fixture.nativeElement.querySelector('.activity-card').textContent).not.toContain('Older scan');
    expect(fixture.nativeElement.querySelectorAll('.status-card').length).toBe(2);
  });

  it('labels failed and skipped scans without treating their missing counts as completed results', () => {
    flushInitRequests({ scanHistory: { history: [
      activity({ status: 'error', missing: 0 }),
      activity({ id: 'scan-2', status: 'skipped', mediaType: 'tv', missing: 0 }),
    ] } });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.activity-row');
    expect(rows[0].textContent).toContain('Failed');
    expect(rows[1].textContent).toContain('Skipped');
    expect(fixture.nativeElement.querySelectorAll('.activity-count').length).toBe(0);
  });

  it('keeps the full library list accessible when the visible text is shortened', () => {
    const libraries = ['A very long movie library name', 'Another very long library', 'Family films'];
    flushInitRequests({ scanHistory: { history: [activity({ libraries })] } });
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('.activity-libraries');
    expect(label.textContent).toBe(libraries.join(', '));
    expect(label.title).toBe(libraries.join(', '));
    expect(fixture.nativeElement.querySelector('.activity-heading a').getAttribute('href')).toBe('/scan-history');
  });

  it('shows a compact empty state without adding placeholder rows', () => {
    flushInitRequests();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.activity-card').textContent).toContain('No scans yet');
    expect(fixture.nativeElement.querySelectorAll('.activity-row').length).toBe(0);
  });

  it('replaces recent activity after completion instead of growing the list', () => {
    flushInitRequests({ scanHistory: { history: [activity()] } });
    component.refreshScanSummaries();
    httpMock.expectOne(`${environment.apiUrl}/schedule`).flush({});
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`).flush({ history: [
      activity({ id: 'scan-new', libraries: ['New scan'], missing: 15 }), activity(),
    ] });
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.activity-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('New scan');
    expect(rows[0].textContent).toContain('15 missing');
  });

  it('keeps previous activity on a failed refresh and provides a retry', () => {
    flushInitRequests({ scanHistory: { history: [activity()] } });
    component.loadScanHistory();
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`).flush({}, { status: 503, statusText: 'Offline' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.activity-error').textContent).toContain('Could not refresh');
    expect(fixture.nativeElement.querySelectorAll('.activity-row').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.activity-card').textContent).not.toContain('No scans yet');
    fixture.nativeElement.querySelector('.activity-error button').click();
    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=3`).flush({ history: [activity({ missing: 12 })] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.activity-error')).toBeNull();
    expect(fixture.nativeElement.querySelector('.activity-count').textContent).toContain('12 missing');
  });
  it('uses the same local date format, including the year for older schedule and activity entries', () => {
    const year = new Date().getFullYear() - 1;
    const timestamp = new Date(year, 8, 24, 4).toISOString();
    flushInitRequests({
      schedule: { movie: { enabled: false }, tv: { enabled: false }, run_history: [scheduledRun('movie', timestamp, 42)] },
      scanHistory: { history: [activity({ timestamp })] },
    });
    fixture.detectChanges();
    const label = `Sep 24, ${year} at 4:00 AM`;
    expect(fixture.nativeElement.querySelector('.schedule-last').textContent).toContain(label);
    expect(fixture.nativeElement.querySelector('.activity-meta').textContent).toContain(label);
    expect(fixture.nativeElement.querySelector('.dashboard-heading').textContent).toContain(component.localTimezone);
  });

});
