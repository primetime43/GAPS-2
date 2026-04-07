import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
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
    progress?: any;
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
      .flush(options?.schedule ?? { enabled: false, preset: '', next_run: null, presets: {} });
    httpMock.expectOne(`${environment.apiUrl}/recommendations/scan/progress`)
      .flush(options?.progress ?? { status: 'idle' });
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
      schedule: { enabled: true, preset: 'daily', next_run: '2026-04-07T00:00:00Z', presets: {} },
    });
    tick();

    expect(component.scheduleEnabled).toBeTrue();
    expect(component.schedulePreset).toBe('daily');
    expect(component.nextRun).toBe('2026-04-07T00:00:00Z');
  }));

  it('should load last scan status when scan is done', fakeAsync(() => {
    flushInitRequests({
      progress: {
        status: 'done',
        gaps: [{ tmdbId: 1 }, { tmdbId: 2 }],
        total_owned: 500,
      },
    });
    tick();

    expect(component.lastScanStatus).toBe('done');
    expect(component.lastScanGaps).toBe(2);
    expect(component.lastScanTotal).toBe(500);
  }));
});
