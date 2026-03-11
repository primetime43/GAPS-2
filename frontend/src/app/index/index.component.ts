import { Component, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TmdbService } from '../services/tmdb/tmdb.service';
import { PlexService } from '../services/plex.service';
import { JellyfinService } from '../services/jellyfin.service';
import { EmbyService } from '../services/emby.service';
import { ScheduleService, ScheduleConfig } from '../services/schedule.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

@Component({
    selector: 'app-index',
    templateUrl: './index.component.html',
    styleUrls: ['./index.component.scss'],
    standalone: false
})
export class IndexComponent implements OnInit {
  tmdbConfigured = false;
  mediaServerConnected = false;
  mediaServerName = '';
  mediaServerType = '';
  loading = true;

  scheduleEnabled = false;
  schedulePreset = '';
  nextRun: string | null = null;

  lastScanStatus = '';
  lastScanGaps = 0;
  lastScanTotal = 0;

  constructor(
    private tmdbService: TmdbService,
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
    private scheduleService: ScheduleService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.tmdbService.getStatus().subscribe({
      next: (status) => this.tmdbConfigured = status.hasKey,
      error: () => {}
    });

    forkJoin({
      plex: this.plexService.getActiveServer().pipe(catchError(() => of(null))),
      jellyfin: this.jellyfinService.getActiveServer().pipe(catchError(() => of(null))),
      emby: this.embyService.getActiveServer().pipe(catchError(() => of(null))),
    }).subscribe((servers) => {
      if (servers.plex && (servers.plex as any).server) {
        this.mediaServerConnected = true;
        this.mediaServerName = (servers.plex as any).server;
        this.mediaServerType = 'Plex';
      } else if (servers.jellyfin && (servers.jellyfin as any).server) {
        this.mediaServerConnected = true;
        this.mediaServerName = (servers.jellyfin as any).server;
        this.mediaServerType = 'Jellyfin';
      } else if (servers.emby && (servers.emby as any).server) {
        this.mediaServerConnected = true;
        this.mediaServerName = (servers.emby as any).server;
        this.mediaServerType = 'Emby';
      }
      this.loading = false;
    });

    this.scheduleService.getSchedule().subscribe({
      next: (config: ScheduleConfig) => {
        this.scheduleEnabled = config.enabled;
        this.schedulePreset = config.preset;
        this.nextRun = config.next_run;
      },
      error: () => {}
    });

    this.http.get<any>(`${environment.apiUrl}/recommendations/scan/progress`).subscribe({
      next: (progress) => {
        if (progress.status === 'done') {
          this.lastScanStatus = 'done';
          this.lastScanGaps = (progress.gaps || []).length;
          this.lastScanTotal = progress.total_owned || 0;
        }
      },
      error: () => {}
    });
  }
}
