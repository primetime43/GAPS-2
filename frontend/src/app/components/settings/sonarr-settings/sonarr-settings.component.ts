import { Component, OnInit } from '@angular/core';
import {
  SonarrService, SonarrConfig, SonarrQualityProfile, SonarrLanguageProfile, SonarrRootFolder,
} from '../../../services/sonarr.service';

@Component({
  selector: 'app-sonarr-settings',
  templateUrl: './sonarr-settings.component.html',
  styleUrls: ['./sonarr-settings.component.scss'],
  standalone: false,
})
export class SonarrSettingsComponent implements OnInit {
  config: SonarrConfig = {
    enabled: false,
    url: '',
    api_key: '',
    quality_profile_id: 0,
    language_profile_id: 0,
    root_folder_path: '',
    monitored: true,
    season_folder: true,
    search_on_add: true,
  };
  profiles: SonarrQualityProfile[] = [];
  languageProfiles: SonarrLanguageProfile[] = [];
  rootFolders: SonarrRootFolder[] = [];
  testing = false;
  saving = false;
  loadingMeta = false;
  showKey = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';

  constructor(private sonarr: SonarrService) {}

  ngOnInit(): void {
    this.sonarr.getConfig().subscribe({
      next: (cfg) => {
        this.config = cfg;
        if (cfg.enabled) this.loadMeta();
      },
      error: () => {},
    });
  }

  loadMeta(): void {
    this.loadingMeta = true;
    this.sonarr.getProfiles().subscribe({
      next: (profiles) => {
        this.profiles = profiles;
        this.loadingMeta = false;
      },
      error: (err) => {
        this.loadingMeta = false;
        this.showMessage(err.error?.error || 'Could not load quality profiles', 'error');
      },
    });
    this.sonarr.getLanguageProfiles().subscribe({
      next: (profiles) => (this.languageProfiles = profiles),
      error: () => {},
    });
    this.sonarr.getRootFolders().subscribe({
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
    this.sonarr.testConnection(this.config.url, this.config.api_key).subscribe({
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
    this.sonarr.saveConfig(this.config).subscribe({
      next: (cfg) => {
        this.config = cfg;
        this.showMessage('Sonarr settings saved.', 'success');
        this.saving = false;
        if (cfg.enabled && this.profiles.length === 0) this.loadMeta();
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Failed to save settings', 'error');
        this.saving = false;
      },
    });
  }

  clearConfig(): void {
    this.sonarr.clearConfig().subscribe({
      next: () => {
        this.config = {
          enabled: false,
          url: '',
          api_key: '',
          quality_profile_id: 0,
          language_profile_id: 0,
          root_folder_path: '',
          monitored: true,
          season_folder: true,
          search_on_add: true,
        };
        this.profiles = [];
        this.languageProfiles = [];
        this.rootFolders = [];
        this.showMessage('Sonarr settings cleared.', 'success');
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
