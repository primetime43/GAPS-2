import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, timeout } from 'rxjs/operators';
import { Router } from '@angular/router';
import { TmdbService } from '../services/tmdb/tmdb.service';
import { ActiveServerService } from '../services/active-server.service';
import { ScheduleService, ScheduleConfig, ScheduleLastRun } from '../services/schedule.service';
import { ScanHistoryEntry, ScanHistoryService } from '../services/scan-history.service';
import { RadarrService } from '../services/radarr.service';
import { SonarrService } from '../services/sonarr.service';
import { TvdbService } from '../services/tvdb.service';
import { PlexService } from '../services/plex.service';
import { JellyfinService } from '../services/jellyfin.service';
import { EmbyService } from '../services/emby.service';

interface ConnectionStatus {
  name: string;
  settings: string;
  state: 'checking' | 'connected' | 'disabled' | 'attention';
  label: string;
  detail: string;
}

@Component({
    selector: 'app-index',
    templateUrl: './index.component.html',
    styleUrls: ['./index.component.scss'],
    standalone: false
})
export class IndexComponent implements OnInit {
  connections: ConnectionStatus[] = [
    this.connection('TMDB', 'tmdb'),
    this.connection('Media server', 'plex'),
    this.connection('Radarr', 'radarr'),
    this.connection('Sonarr', 'sonarr'),
    this.connection('TheTVDB', 'tvdb'),
  ];

  scheduleEnabled = false;
  schedulePreset = '';
  nextRun: string | null = null;
  scheduleLastRun: ScheduleLastRun | null = null;

  lastMovieScan: ScanHistoryEntry | null = null;
  lastTvScan: ScanHistoryEntry | null = null;

  constructor(
    private tmdbService: TmdbService,
    private activeServerService: ActiveServerService,
    private scheduleService: ScheduleService,
    private scanHistoryService: ScanHistoryService,
    private router: Router,
    private radarrService: RadarrService,
    private sonarrService: SonarrService,
    private tvdbService: TvdbService,
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.checkConnections();

    this.scheduleService.getSchedule().subscribe({
      next: (config: ScheduleConfig) => {
        this.scheduleEnabled = config.enabled;
        this.schedulePreset = config.description || config.preset;
        this.nextRun = config.next_run;
        this.scheduleLastRun = config.last_run;
      },
      error: () => {}
    });

    this.loadScanHistory();
  }

  loadScanHistory(): void {
    this.scanHistoryService.get().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (resp) => {
        this.lastMovieScan = resp.lastMovie;
        this.lastTvScan = resp.lastTv;
      },
      error: () => {},
    });
  }

  private connection(name: string, settings: string): ConnectionStatus {
    return { name, settings: `/settings/${settings}`, state: 'checking', label: 'Checking', detail: '' };
  }

  get checkingConnections(): boolean {
    return this.connections.some(connection => connection.state === 'checking');
  }

  get connectionAlerts(): ConnectionStatus[] {
    return this.connections.filter(connection => connection.state === 'attention');
  }

  checkConnections(): void {
    this.connections.forEach(connection => {
      connection.state = 'checking';
      connection.label = 'Checking';
      connection.detail = '';
    });
    const [tmdb, media, radarr, sonarr, tvdb] = this.connections;
    this.check(tmdb, this.tmdbService.getStatus().pipe(switchMap(status => {
      if (!status.hasKey) return of(this.needsSetup('Add a TMDB API key to scan for missing movies.'));
      return this.tmdbService.testApiKey(status.apiKey).pipe(map(() => this.connected()));
    })));
    this.check(media, this.activeServerService.getActive().pipe(switchMap(active => {
      if (!active) {
        media.name = 'Media server';
        media.settings = '/settings/plex';
        return of(this.needsSetup('No active media server is available. Connect Plex, Jellyfin, or Emby in Settings.'));
      }
      media.name = active.typeLabel;
      media.settings = `/settings/${active.source}`;
      const service = { plex: this.plexService, jellyfin: this.jellyfinService, emby: this.embyService }[active.source];
      return service.testConnection().pipe(map(result => result.connected
        ? this.connected(active.server)
        : { state: 'attention' as const, label: 'Connection failed', detail: `Cannot connect to ${active.server}. Check the server and connection settings.` }));
    })));
    this.checkOptional(radarr, this.radarrService.getConfig(),
      config => !!(config.url && config.api_key),
      config => this.radarrService.testConnection(config.url, config.api_key));
    this.checkOptional(sonarr, this.sonarrService.getConfig(),
      config => !!(config.url && config.api_key),
      config => this.sonarrService.testConnection(config.url, config.api_key));
    this.checkOptional(tvdb, this.tvdbService.getConfig(),
      config => !!config.api_key,
      config => this.tvdbService.testConnection(config.api_key, config.pin));
  }

  private connected(detail = ''): Pick<ConnectionStatus, 'state' | 'label' | 'detail'> {
    return { state: 'connected', label: 'Connected', detail };
  }

  private needsSetup(detail: string): Pick<ConnectionStatus, 'state' | 'label' | 'detail'> {
    return { state: 'attention', label: 'Setup needed', detail };
  }

  private checkOptional<T extends { enabled: boolean }>(
    connection: ConnectionStatus, config$: Observable<T>, configured: (config: T) => boolean,
    test: (config: T) => Observable<unknown>,
  ): void {
    this.check(connection, config$.pipe(switchMap(config => {
      if (!config.enabled) return of({ state: 'disabled' as const, label: 'Disabled', detail: '' });
      if (!configured(config)) return of(this.needsSetup(`${connection.name} is enabled but its connection settings are incomplete.`));
      return test(config).pipe(map(() => this.connected()));
    })));
  }

  private check(connection: ConnectionStatus, request: Observable<Pick<ConnectionStatus, 'state' | 'label' | 'detail'>>): void {
    request.pipe(
      timeout(30000),
      catchError(() => of({
        state: 'attention' as const, label: 'Check failed',
        detail: `Could not verify ${connection.name}. Check its settings and availability, then try again.`,
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(status => Object.assign(connection, status));
  }

  get hasAnyLastScan(): boolean {
    return !!(this.lastMovieScan || this.lastTvScan);
  }

  openHistory(): void {
    if (!this.hasAnyLastScan) return;
    this.router.navigate(['/scan-history']);
  }
}
