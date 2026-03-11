import { Component, OnInit } from '@angular/core';
import { TmdbService } from '../services/tmdb/tmdb.service';
import { PlexService } from '../services/plex.service';
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
  plexConnected = false;
  plexServerName = '';
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
    private scheduleService: ScheduleService,
    private http: HttpClient
  ) {}

  ngOnInit(): void {
    this.tmdbConfigured = this.tmdbService.hasApiKey();

    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        this.plexConnected = !!(res && res.server);
        this.plexServerName = res?.server || '';
        this.loading = false;
      },
      error: () => {
        this.plexConnected = false;
        this.loading = false;
      }
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
