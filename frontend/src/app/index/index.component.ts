import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TmdbService } from '../services/tmdb/tmdb.service';
import { ActiveServerService } from '../services/active-server.service';
import { ScheduleService, ScheduleConfig, ScheduleLastRun } from '../services/schedule.service';
import { ScanHistoryEntry, ScanHistoryService } from '../services/scan-history.service';

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
  scheduleLastRun: ScheduleLastRun | null = null;

  lastMovieScan: ScanHistoryEntry | null = null;
  lastTvScan: ScanHistoryEntry | null = null;

  constructor(
    private tmdbService: TmdbService,
    private activeServerService: ActiveServerService,
    private scheduleService: ScheduleService,
    private scanHistoryService: ScanHistoryService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.tmdbService.getStatus().subscribe({
      next: (status) => this.tmdbConfigured = status.hasKey,
      error: () => {}
    });

    this.activeServerService.getActive().subscribe((active) => {
      if (active) {
        this.mediaServerConnected = true;
        this.mediaServerName = active.server;
        this.mediaServerType = active.typeLabel;
      }
      this.loading = false;
    });

    this.scheduleService.getSchedule().subscribe({
      next: (config: ScheduleConfig) => {
        this.scheduleEnabled = config.enabled;
        this.schedulePreset = config.preset;
        this.nextRun = config.next_run;
        this.scheduleLastRun = config.last_run;
      },
      error: () => {}
    });

    this.scanHistoryService.get().subscribe({
      next: (resp) => {
        this.lastMovieScan = resp.lastMovie;
        this.lastTvScan = resp.lastTv;
      },
      error: () => {},
    });
  }

  get hasAnyLastScan(): boolean {
    return !!(this.lastMovieScan || this.lastTvScan);
  }

  openHistory(): void {
    if (!this.hasAnyLastScan) return;
    this.router.navigate(['/scan-history']);
  }
}
