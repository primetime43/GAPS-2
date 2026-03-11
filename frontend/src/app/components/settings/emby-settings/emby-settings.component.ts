import { Component, OnInit } from '@angular/core';
import { EmbyService } from '../../../services/emby.service';
import { MediaLibrary } from '../../../models/media-server.model';

@Component({
    selector: 'app-emby-settings',
    templateUrl: './emby-settings.component.html',
    styleUrls: ['./emby-settings.component.scss'],
    standalone: false
})
export class EmbySettingsComponent implements OnInit {
  serverUrl = '';
  apiKey = '';
  serverName = '';
  libraries: MediaLibrary[] = [];

  hasActiveServer = false;
  activeServer = '';
  activeLibraries: MediaLibrary[] = [];
  serverExpanded = false;

  step: 'idle' | 'connecting' | 'connected' | 'saving' = 'idle';
  statusMessage = '';
  statusType: 'success' | 'error' | '' = '';
  apiKeyVisible = false;

  constructor(private embyService: EmbyService) {}

  ngOnInit(): void {
    this.loadActiveServer();
  }

  connect(): void {
    if (!this.serverUrl || !this.apiKey) return;
    this.step = 'connecting';
    this.clearMessage();

    this.embyService.connect(this.serverUrl, this.apiKey).subscribe({
      next: (res) => {
        if (res.connected) {
          this.serverName = res.serverName;
          this.libraries = res.libraries || [];
          this.step = 'connected';
        } else {
          this.showMessage(res.error || 'Could not connect to Emby server.', 'error');
          this.step = 'idle';
        }
      },
      error: () => {
        this.showMessage('Failed to connect. Check the URL and API key.', 'error');
        this.step = 'idle';
      }
    });
  }

  save(): void {
    this.step = 'saving';
    this.embyService.save(this.serverUrl, this.apiKey, this.serverName, this.libraries).subscribe({
      next: () => {
        this.showMessage('Emby server saved!', 'success');
        this.step = 'idle';
        this.loadActiveServer();
      },
      error: () => {
        this.showMessage('Failed to save server.', 'error');
        this.step = 'connected';
      }
    });
  }

  disconnect(): void {
    this.hasActiveServer = false;
    this.step = 'idle';
    this.clearMessage();
  }

  removeServer(): void {
    this.embyService.removeServer().subscribe({
      next: () => {
        this.hasActiveServer = false;
        this.activeServer = '';
        this.activeLibraries = [];
        this.serverExpanded = false;
        this.step = 'idle';
        this.showMessage('Server removed.', 'success');
      },
      error: () => this.showMessage('Failed to remove server.', 'error')
    });
  }

  toggleApiKeyVisibility(): void {
    this.apiKeyVisible = !this.apiKeyVisible;
  }

  get movieLibraries(): MediaLibrary[] {
    return this.libraries.filter(l => l.type === 'movie');
  }

  get activeMovieLibraries(): MediaLibrary[] {
    return this.activeLibraries.filter(l => l.type === 'movie');
  }

  get activeOtherLibraries(): MediaLibrary[] {
    return this.activeLibraries.filter(l => l.type !== 'movie');
  }

  private loadActiveServer(): void {
    this.embyService.getActiveServer().subscribe({
      next: (res) => {
        if (res && res.server) {
          this.hasActiveServer = true;
          this.activeServer = res.server;
          this.activeLibraries = Array.isArray(res.libraries) ? res.libraries : [];
        }
      },
      error: () => {}
    });
  }

  private showMessage(msg: string, type: 'success' | 'error'): void {
    this.statusMessage = msg;
    this.statusType = type;
  }

  private clearMessage(): void {
    this.statusMessage = '';
    this.statusType = '';
  }
}
