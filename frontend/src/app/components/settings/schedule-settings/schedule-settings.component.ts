import { Component, OnInit } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ScheduleService, ScheduleConfig } from '../../../services/schedule.service';
import { PlexService } from '../../../services/plex.service';
import { JellyfinService } from '../../../services/jellyfin.service';
import { EmbyService } from '../../../services/emby.service';
import { PlexLibrary, ActiveServerResponse } from '../../../models/plex.model';

@Component({
  selector: 'app-schedule-settings',
  templateUrl: './schedule-settings.component.html',
  styleUrls: ['./schedule-settings.component.scss'],
  standalone: false
})
export class ScheduleSettingsComponent implements OnInit {
  schedule: ScheduleConfig | null = null;
  libraries: PlexLibrary[] = [];
  selectedPreset = '';
  selectedLibrary = '';
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';
  saving = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';
  loading = true;

  presetKeys: string[] = [];

  constructor(
    private scheduleService: ScheduleService,
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
  ) {}

  ngOnInit(): void {
    // Detect active media server
    forkJoin({
      plex: this.plexService.getActiveServer().pipe(catchError(() => of(null))),
      jellyfin: this.jellyfinService.getActiveServer().pipe(catchError(() => of(null))),
      emby: this.embyService.getActiveServer().pipe(catchError(() => of(null))),
    }).subscribe((servers) => {
      let res: ActiveServerResponse | null = null;

      if (servers.plex && (servers.plex as any).server) {
        res = servers.plex as ActiveServerResponse;
        this.activeSource = 'plex';
      } else if (servers.jellyfin && (servers.jellyfin as any).server) {
        res = servers.jellyfin as ActiveServerResponse;
        this.activeSource = 'jellyfin';
      } else if (servers.emby && (servers.emby as any).server) {
        res = servers.emby as ActiveServerResponse;
        this.activeSource = 'emby';
      }

      if (res && res.libraries) {
        this.activeServerName = res.server;
        this.libraries = res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie');
      }
    });

    this.scheduleService.getSchedule().subscribe({
      next: (config) => {
        this.schedule = config;
        this.selectedPreset = config.preset || '';
        this.selectedLibrary = config.library || '';
        if (config.source) {
          this.activeSource = config.source as any;
        }
        this.presetKeys = Object.keys(config.presets);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  saveSchedule(): void {
    if (!this.selectedPreset || !this.selectedLibrary) {
      this.showMessage('Please select a frequency and library.', 'error');
      return;
    }

    this.saving = true;
    this.clearMessage();
    this.scheduleService.setSchedule(this.selectedPreset, this.selectedLibrary, this.activeSource).subscribe({
      next: (config) => {
        this.schedule = config;
        this.showMessage('Schedule saved.', 'success');
        this.saving = false;
      },
      error: () => {
        this.showMessage('Failed to save schedule.', 'error');
        this.saving = false;
      }
    });
  }

  disableSchedule(): void {
    this.saving = true;
    this.clearMessage();
    this.scheduleService.disableSchedule().subscribe({
      next: (config) => {
        this.schedule = config;
        this.showMessage('Schedule disabled.', 'success');
        this.saving = false;
      },
      error: () => {
        this.showMessage('Failed to disable schedule.', 'error');
        this.saving = false;
      }
    });
  }

  private showMessage(msg: string, type: 'success' | 'error'): void {
    this.message = msg;
    this.messageType = type;
  }

  private clearMessage(): void {
    this.message = '';
    this.messageType = '';
  }
}
