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
    tmdb?: { hasKey: boolean };
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
    httpMock.expectOne(`${environment.apiUrl}/schedule`)
      .flush(options?.schedule ?? { enabled: false, preset: '', next_run: null, last_run: null, run_history: [], presets: {} });
    httpMock.expectOne(`${environment.apiUrl}/scan-history`)
      .flush(options?.scanHistory ?? { history: [], lastMovie: null, lastTv: null });
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in loading state', () => {
    expect(component.loading).toBeTrue();
    expect(component.tmdbConfigured).toBeFalse();
    expect(component.mediaServerConnected).toBeFalse();
  });

  it('should detect TMDB is configured', fakeAsync(() => {
    flushInitRequests({ tmdb: { hasKey: true } });
    tick();

    expect(component.tmdbConfigured).toBeTrue();
  }));

  it('should detect Plex as connected media server', fakeAsync(() => {
    flushInitRequests({
      plex: { server: 'My Plex', libraries: [] },
    });
    tick();

    expect(component.mediaServerConnected).toBeTrue();
    expect(component.mediaServerName).toBe('My Plex');
    expect(component.mediaServerType).toBe('Plex');
    expect(component.loading).toBeFalse();
  }));

  it('should detect Jellyfin as connected media server', fakeAsync(() => {
    flushInitRequests({
      jellyfin: { server: 'My Jellyfin', libraries: [] },
    });
    tick();

    expect(component.mediaServerConnected).toBeTrue();
    expect(component.mediaServerName).toBe('My Jellyfin');
    expect(component.mediaServerType).toBe('Jellyfin');
  }));

  it('should detect Emby as connected media server', fakeAsync(() => {
    flushInitRequests({
      emby: { server: 'My Emby', libraries: [] },
    });
    tick();

    expect(component.mediaServerConnected).toBeTrue();
    expect(component.mediaServerName).toBe('My Emby');
    expect(component.mediaServerType).toBe('Emby');
  }));

  it('should prioritize Plex over Jellyfin and Emby', fakeAsync(() => {
    flushInitRequests({
      plex: { server: 'Plex', libraries: [] },
      jellyfin: { server: 'Jellyfin', libraries: [] },
      emby: { server: 'Emby', libraries: [] },
    });
    tick();

    expect(component.mediaServerType).toBe('Plex');
  }));

  it('should show no server connected when none are active', fakeAsync(() => {
    flushInitRequests();
    tick();

    expect(component.mediaServerConnected).toBeFalse();
    expect(component.loading).toBeFalse();
  }));

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
