import { Component, OnInit } from '@angular/core';
import { TvdbService, TvdbConfig } from '../../../services/tvdb.service';

@Component({
  selector: 'app-tvdb-settings',
  templateUrl: './tvdb-settings.component.html',
  styleUrls: ['./tvdb-settings.component.scss'],
  standalone: false,
})
export class TvdbSettingsComponent implements OnInit {
  config: TvdbConfig = {
    enabled: false,
    api_key: '',
    pin: '',
    language: 'eng',
  };
  testing = false;
  saving = false;
  showKey = false;
  showPin = false;
  revealingKey = false;
  revealingPin = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';

  constructor(private tvdb: TvdbService) {}

  private static isMasked(value: string | undefined | null): boolean {
    return !!value && /^•+$/.test(value);
  }

  toggleShowKey(): void {
    if (this.showKey) {
      this.showKey = false;
      return;
    }
    if (!TvdbSettingsComponent.isMasked(this.config.api_key)) {
      this.showKey = true;
      return;
    }
    this.revealingKey = true;
    this.tvdb.getConfig(true).subscribe({
      next: (cfg) => {
        this.config.api_key = cfg.api_key;
        this.config.pin = cfg.pin;
        this.showKey = true;
        this.revealingKey = false;
      },
      error: () => {
        this.revealingKey = false;
        this.showKey = true;
      },
    });
  }

  toggleShowPin(): void {
    if (this.showPin) {
      this.showPin = false;
      return;
    }
    if (!TvdbSettingsComponent.isMasked(this.config.pin)) {
      this.showPin = true;
      return;
    }
    this.revealingPin = true;
    this.tvdb.getConfig(true).subscribe({
      next: (cfg) => {
        this.config.api_key = cfg.api_key;
        this.config.pin = cfg.pin;
        this.showPin = true;
        this.revealingPin = false;
      },
      error: () => {
        this.revealingPin = false;
        this.showPin = true;
      },
    });
  }

  ngOnInit(): void {
    this.tvdb.getConfig().subscribe({
      next: (cfg) => (this.config = cfg),
      error: () => {},
    });
  }

  testConnection(): void {
    if (!this.config.api_key) {
      this.showMessage('API key is required.', 'error');
      return;
    }
    this.testing = true;
    this.clearMessage();
    this.tvdb.testConnection(this.config.api_key, this.config.pin).subscribe({
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
    if (!this.config.api_key) {
      this.showMessage('API key is required.', 'error');
      return;
    }
    this.saving = true;
    this.clearMessage();
    this.tvdb.saveConfig(this.config).subscribe({
      next: (cfg) => {
        this.config = cfg;
        this.showMessage('TheTVDB settings saved.', 'success');
        this.saving = false;
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Failed to save settings', 'error');
        this.saving = false;
      },
    });
  }

  clearConfig(): void {
    this.tvdb.clearConfig().subscribe({
      next: () => {
        this.config = { enabled: false, api_key: '', pin: '', language: 'eng' };
        this.showMessage('TheTVDB settings cleared.', 'success');
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
