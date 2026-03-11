import { Component, OnInit } from '@angular/core';
import { ScheduleService, ScheduleConfig } from '../../../services/schedule.service';
import { PlexService } from '../../../services/plex.service';
import { PlexLibrary } from '../../../models/plex.model';

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
  saving = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';
  loading = true;

  presetKeys: string[] = [];

  constructor(
    private scheduleService: ScheduleService,
    private plexService: PlexService,
  ) {}

  ngOnInit(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        if (res && res.libraries) {
          this.libraries = res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie');
        }
      }
    });

    this.scheduleService.getSchedule().subscribe({
      next: (config) => {
        this.schedule = config;
        this.selectedPreset = config.preset || '';
        this.selectedLibrary = config.library || '';
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
    this.scheduleService.setSchedule(this.selectedPreset, this.selectedLibrary).subscribe({
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
