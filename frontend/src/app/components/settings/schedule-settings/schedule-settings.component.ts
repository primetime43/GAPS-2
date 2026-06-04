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
  movieTime = '04:00';
  movieDayOfWeek = 'mon';
  tvPreset = '';
  tvLibrary = '';
  tvTime = '04:00';
  tvDayOfWeek = 'mon';

  saving: { movie: boolean; tv: boolean } = { movie: false, tv: false };
  message = '';
  messageType: 'success' | 'error' | '' = '';

  presetKeys: string[] = [];
  days: { [key: string]: string } = {};
  dayKeys: string[] = [];

  /** Time-of-day applies to every frequency except hourly (which runs on the hour). */
  showTime(preset: string): boolean {
    return !!preset && preset !== 'hourly';
  }

  /** Day-of-week only applies to the weekly frequency. */
  showDayOfWeek(preset: string): boolean {
    return preset === 'weekly';
  }

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
    this.movieTime = this.formatTime(config.movie?.hour ?? 4, config.movie?.minute ?? 0);
    this.movieDayOfWeek = config.movie?.dayOfWeek || 'mon';
    this.tvPreset = config.tv?.preset || '';
    this.tvLibrary = config.tv?.library || '';
    this.tvTime = this.formatTime(config.tv?.hour ?? 4, config.tv?.minute ?? 0);
    this.tvDayOfWeek = config.tv?.dayOfWeek || 'mon';
    if (config.source) {
      this.activeSource = config.source as any;
    }
    this.presetKeys = Object.keys(config.presets);
    this.days = config.days || {};
    this.dayKeys = Object.keys(this.days);
  }

  private formatTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private parseTime(value: string): [number, number] {
    const [h, m] = (value || '04:00').split(':').map(n => parseInt(n, 10));
    return [isNaN(h) ? 4 : h, isNaN(m) ? 0 : m];
  }

  save(type: MediaType): void {
    const preset = type === 'tv' ? this.tvPreset : this.moviePreset;
    const library = type === 'tv' ? this.tvLibrary : this.movieLibrary;
    if (!preset || !library) {
      this.showMessage(`Select a frequency and library for the ${type === 'tv' ? 'TV' : 'movie'} schedule.`, 'error');
      return;
    }
    const [hour, minute] = this.parseTime(type === 'tv' ? this.tvTime : this.movieTime);
    const dayOfWeek = type === 'tv' ? this.tvDayOfWeek : this.movieDayOfWeek;
    this.saving[type] = true;
    this.clearMessage();
    this.scheduleService.setSchedule({
      mediaType: type, preset, library, source: this.activeSource, hour, minute, dayOfWeek,
    }).subscribe({
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
