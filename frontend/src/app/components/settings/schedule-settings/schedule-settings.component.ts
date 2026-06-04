import { Component, OnInit } from '@angular/core';
import { ScheduleService, ScheduleConfig } from '../../../services/schedule.service';
import { ActiveServerService } from '../../../services/active-server.service';
import { MediaLibrary } from '../../../models/media-server.model';

type MediaType = 'movie' | 'tv';

@Component({
  selector: 'app-schedule-settings',
  templateUrl: './schedule-settings.component.html',
  styleUrls: ['./schedule-settings.component.scss'],
  standalone: false
})
export class ScheduleSettingsComponent implements OnInit {
  schedule: ScheduleConfig | null = null;
  libraries: MediaLibrary[] = [];
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';
  loading = true;

  // Per-media-type form selections.
  moviePreset = '';
  movieLibrary = '';
  tvPreset = '';
  tvLibrary = '';

  saving: { movie: boolean; tv: boolean } = { movie: false, tv: false };
  message = '';
  messageType: 'success' | 'error' | '' = '';

  presetKeys: string[] = [];

  get movieLibraries(): MediaLibrary[] {
    return this.libraries.filter(l => l.type === 'movie');
  }

  get tvLibraries(): MediaLibrary[] {
    return this.libraries.filter(l => l.type === 'show' || l.type === 'tvshows');
  }

  constructor(
    private scheduleService: ScheduleService,
    private activeServerService: ActiveServerService,
  ) {}

  ngOnInit(): void {
    this.activeServerService.getActive().subscribe((active) => {
      if (active) {
        this.activeSource = active.source;
        this.activeServerName = active.server;
        this.libraries = active.libraries.filter(
          (lib: MediaLibrary) => lib.type === 'movie' || lib.type === 'show' || lib.type === 'tvshows'
        );
      }
    });

    this.scheduleService.getSchedule().subscribe({
      next: (config) => {
        this.applyConfig(config);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  private applyConfig(config: ScheduleConfig): void {
    this.schedule = config;
    this.moviePreset = config.movie?.preset || '';
    this.movieLibrary = config.movie?.library || '';
    this.tvPreset = config.tv?.preset || '';
    this.tvLibrary = config.tv?.library || '';
    if (config.source) {
      this.activeSource = config.source as any;
    }
    this.presetKeys = Object.keys(config.presets);
  }

  save(type: MediaType): void {
    const preset = type === 'tv' ? this.tvPreset : this.moviePreset;
    const library = type === 'tv' ? this.tvLibrary : this.movieLibrary;
    if (!preset || !library) {
      this.showMessage(`Select a frequency and library for the ${type === 'tv' ? 'TV' : 'movie'} schedule.`, 'error');
      return;
    }
    this.saving[type] = true;
    this.clearMessage();
    this.scheduleService.setSchedule(type, preset, library, this.activeSource).subscribe({
      next: (config) => {
        this.applyConfig(config);
        this.showMessage(`${type === 'tv' ? 'TV' : 'Movie'} schedule saved.`, 'success');
        this.saving[type] = false;
      },
      error: () => {
        this.showMessage('Failed to save schedule.', 'error');
        this.saving[type] = false;
      }
    });
  }

  disable(type: MediaType): void {
    this.saving[type] = true;
    this.clearMessage();
    this.scheduleService.disableSchedule(type).subscribe({
      next: (config) => {
        this.applyConfig(config);
        this.showMessage(`${type === 'tv' ? 'TV' : 'Movie'} schedule disabled.`, 'success');
        this.saving[type] = false;
      },
      error: () => {
        this.showMessage('Failed to disable schedule.', 'error');
        this.saving[type] = false;
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
