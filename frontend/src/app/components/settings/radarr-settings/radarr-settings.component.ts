import { Component, OnInit } from '@angular/core';
import { RadarrService, RadarrConfig, RadarrQualityProfile, RadarrRootFolder } from '../../../services/radarr.service';

@Component({
  selector: 'app-radarr-settings',
  templateUrl: './radarr-settings.component.html',
  styleUrls: ['./radarr-settings.component.scss'],
  standalone: false,
})
export class RadarrSettingsComponent implements OnInit {
  config: RadarrConfig = {
    enabled: false,
    url: '',
    api_key: '',
    quality_profile_id: 0,
    root_folder_path: '',
    minimum_availability: 'released',
    monitored: true,
    search_on_add: true,
    auto_route_by_decade: false,
  };
  profiles: RadarrQualityProfile[] = [];
  rootFolders: RadarrRootFolder[] = [];
  testing = false;
  saving = false;
  loadingMeta = false;
  showKey = false;
  revealingKey = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';

  private static isMasked(value: string | undefined | null): boolean {
    return !!value && /^•+$/.test(value);
  }

  toggleShowKey(): void {
    if (this.showKey) {
      this.showKey = false;
      return;
    }
    if (!RadarrSettingsComponent.isMasked(this.config.api_key)) {
      this.showKey = true;
      return;
    }
    this.revealingKey = true;
    this.radarr.getConfig(true).subscribe({
      next: (cfg) => {
        this.config.api_key = cfg.api_key;
        this.showKey = true;
        this.revealingKey = false;
      },
      error: () => {
        this.revealingKey = false;
        this.showKey = true;
      },
    });
  }

  availabilityOptions = [
    { value: 'announced', label: 'Announced' },
    { value: 'inCinemas', label: 'In Cinemas' },
    { value: 'released', label: 'Released' },
    { value: 'tba', label: 'TBA' },
  ];

  constructor(private radarr: RadarrService) {}

  ngOnInit(): void {
    this.radarr.getConfig().subscribe({
      next: (cfg) => {
        this.config = cfg;
        if (cfg.enabled) {
          this.loadMeta();
        }
      },
      error: () => {},
    });
  }

  loadMeta(): void {
    this.loadingMeta = true;
    this.radarr.getProfiles().subscribe({
      next: (profiles) => {
        this.profiles = profiles;
        this.loadingMeta = false;
      },
      error: (err) => {
        this.loadingMeta = false;
        this.showMessage(err.error?.error || 'Could not load quality profiles', 'error');
      },
    });
    this.radarr.getRootFolders().subscribe({
      next: (folders) => (this.rootFolders = folders),
      error: () => {},
    });
  }

  testConnection(): void {
    if (!this.config.url || !this.config.api_key) {
      this.showMessage('URL and API key are required.', 'error');
      return;
    }
    this.testing = true;
    this.clearMessage();
    this.radarr.testConnection(this.config.url, this.config.api_key).subscribe({
      next: (res) => {
        this.showMessage(res.message, 'success');
        this.testing = false;
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Connection test failed', 'error');
        this.testing = false;
      },
    });
  }

  saveConfig(): void {
    if (!this.config.url || !this.config.api_key) {
      this.showMessage('URL and API key are required.', 'error');
      return;
    }
    this.saving = true;
    this.clearMessage();
    this.radarr.saveConfig(this.config).subscribe({
      next: (cfg) => {
        this.config = cfg;
        this.showMessage('Radarr settings saved.', 'success');
        this.saving = false;
        if (cfg.enabled && this.profiles.length === 0) {
          this.loadMeta();
        }
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Failed to save settings', 'error');
        this.saving = false;
      },
    });
  }

  clearConfig(): void {
    this.radarr.clearConfig().subscribe({
      next: () => {
        this.config = {
          enabled: false,
          url: '',
          api_key: '',
          quality_profile_id: 0,
          root_folder_path: '',
          minimum_availability: 'released',
          monitored: true,
          search_on_add: true,
          auto_route_by_decade: false,
        };
        this.profiles = [];
        this.rootFolders = [];
        this.showMessage('Radarr settings cleared.', 'success');
      },
      error: (err) => this.showMessage(err.error?.error || 'Failed to clear settings', 'error'),
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
