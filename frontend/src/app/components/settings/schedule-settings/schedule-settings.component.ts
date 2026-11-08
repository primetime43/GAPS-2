import { Component, OnInit } from '@angular/core';
import { ScheduleService, ScheduleConfig, ScheduleBlock } from '../../../services/schedule.service';
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
  activeTab: 'history' | 'schedules' = 'history';

  onTabKeydown(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    this.activeTab = event.key === 'Home' ? 'history' : event.key === 'End' ? 'schedules'
      : this.activeTab === 'history' ? 'schedules' : 'history';
    const tabs = event.currentTarget as HTMLElement;
    tabs.querySelector<HTMLButtonElement>(`#scan-${this.activeTab}-tab`)?.focus();
  }

  readonly localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  schedule: ScheduleConfig | null = null;
  libraries: MediaLibrary[] = [];
  activeSource: 'plex' | 'jellyfin' | 'emby' = 'plex';
  activeServerName = '';
  loading = true;
  savingHistory = false;
  historyError = '';
  historyMessage = '';

  // Per-media-type form selections. Libraries are multi-select (checkboxes).
  moviePreset = '';
  selectedMovieLibraries: string[] = [];
  movieTime = '04:00';
  movieDayOfWeek = 'mon';
  tvPreset = '';
  selectedTvLibraries: string[] = [];
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

  isLibrarySelected(type: MediaType, title: string): boolean {
    const arr = type === 'tv' ? this.selectedTvLibraries : this.selectedMovieLibraries;
    return arr.includes(title);
  }

  toggleLibrary(type: MediaType, title: string): void {
    const arr = type === 'tv' ? this.selectedTvLibraries : this.selectedMovieLibraries;
    const i = arr.indexOf(title);
    if (i >= 0) {
      arr.splice(i, 1);
    } else {
      arr.push(title);
    }
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

  private applyConfig(config: ScheduleConfig, type?: MediaType): void {
    this.schedule = config;
    if (!type || type === 'movie') {
      this.moviePreset = config.movie?.preset || '';
      this.selectedMovieLibraries = [...(config.movie?.libraries || [])];
      [this.movieTime, this.movieDayOfWeek] = this.localFormTime(config.movie);
    }
    if (!type || type === 'tv') {
      this.tvPreset = config.tv?.preset || '';
      this.selectedTvLibraries = [...(config.tv?.libraries || [])];
      [this.tvTime, this.tvDayOfWeek] = this.localFormTime(config.tv);
    }
    this.presetKeys = Object.keys(config.presets);
    this.days = config.days || {};
    this.dayKeys = Object.keys(this.days);
  }

  private formatTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  usesDifferentTimeZone(block?: ScheduleBlock): boolean {
    if (!block?.timezone) return false;
    // Canonicalize aliases such as Etc/UTC and UTC before comparing.
    return new Intl.DateTimeFormat('en', { timeZone: block.timezone }).resolvedOptions().timeZone !== this.localTimeZone;
  }

  private localFormTime(block?: ScheduleBlock): [string, string] {
    if (this.usesDifferentTimeZone(block) && block?.next_run) {
      const next = new Date(block.next_run.replace(' ', 'T'));
      if (!isNaN(next.getTime())) {
        return [this.formatTime(next.getHours(), next.getMinutes()),
          ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][next.getDay()]];
      }
    }
    return [this.formatTime(block?.hour ?? 4, block?.minute ?? 0), block?.dayOfWeek || 'mon'];
  }

  private parseTime(value: string): [number, number] {
    const [h, m] = (value || '04:00').split(':').map(n => parseInt(n, 10));
    return [isNaN(h) ? 4 : h, isNaN(m) ? 0 : m];
  }

  save(type: MediaType): void {
    const preset = type === 'tv' ? this.tvPreset : this.moviePreset;
    const libraries = type === 'tv' ? this.selectedTvLibraries : this.selectedMovieLibraries;
    if (!preset || !libraries.length) {
      this.showMessage(`Select a frequency and at least one library for the ${type === 'tv' ? 'TV' : 'movie'} schedule.`, 'error');
      return;
    }
    const [hour, minute] = this.parseTime(type === 'tv' ? this.tvTime : this.movieTime);
    const dayOfWeek = type === 'tv' ? this.tvDayOfWeek : this.movieDayOfWeek;
    this.saving[type] = true;
    this.clearMessage();
    this.scheduleService.setSchedule({
      mediaType: type, preset, libraries: [...libraries], source: this.activeSource, hour, minute, dayOfWeek,
      timezone: this.localTimeZone,
    }).subscribe({
      next: (config) => {
        this.applyConfig(config, type);
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
        this.applyConfig(config, type);
        this.showMessage(`${type === 'tv' ? 'TV' : 'Movie'} schedule disabled.`, 'success');
        this.saving[type] = false;
      },
      error: () => {
        this.showMessage('Failed to disable schedule.', 'error');
        this.saving[type] = false;
      }
    });
  }

  saveHistoryLimit(limit: number): void {
    if (this.savingHistory) return;
    this.savingHistory = true;
    this.historyError = '';
    this.historyMessage = '';
    this.scheduleService.setHistoryLimit(limit).subscribe({
      next: result => {
        if (this.schedule) this.schedule = { ...this.schedule, ...result };
        this.historyMessage = `Keeping the latest ${result.historyLimit} scheduled runs.`;
        this.savingHistory = false;
      },
      error: err => {
        this.historyError = err.error?.error || 'Could not save the history limit. Please try again.';
        this.savingHistory = false;
      },
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
