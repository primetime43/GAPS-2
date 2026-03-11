import { Component, OnInit } from '@angular/core';
import { JellyfinService } from '../../../services/jellyfin.service';
import { PlexLibrary } from '../../../models/plex.model';

@Component({
    selector: 'app-jellyfin-settings',
    templateUrl: './jellyfin-settings.component.html',
    styleUrls: ['./jellyfin-settings.component.scss'],
    standalone: false
})
export class JellyfinSettingsComponent implements OnInit {
  serverUrl = '';
  apiKey = '';
  serverName = '';
  libraries: PlexLibrary[] = [];

  hasActiveServer = false;
  activeServer = '';
  activeLibraries: PlexLibrary[] = [];
  serverExpanded = false;

  step: 'idle' | 'connecting' | 'connected' | 'saving' = 'idle';
  statusMessage = '';
  statusType: 'success' | 'error' | '' = '';
  apiKeyVisible = false;

  constructor(private jellyfinService: JellyfinService) {}

  ngOnInit(): void {
    this.loadActiveServer();
  }

  connect(): void {
    if (!this.serverUrl || !this.apiKey) return;
    this.step = 'connecting';
    this.clearMessage();

    this.jellyfinService.connect(this.serverUrl, this.apiKey).subscribe({
      next: (res) => {
        if (res.connected) {
          this.serverName = res.serverName;
          this.libraries = res.libraries || [];
          this.step = 'connected';
        } else {
          this.showMessage(res.error || 'Could not connect to Jellyfin server.', 'error');
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
    this.jellyfinService.save(this.serverUrl, this.apiKey, this.serverName, this.libraries).subscribe({
      next: () => {
        this.showMessage('Jellyfin server saved!', 'success');
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
    this.jellyfinService.removeServer().subscribe({
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

  get movieLibraries(): PlexLibrary[] {
    return this.libraries.filter(l => l.type === 'movie');
  }

  get activeMovieLibraries(): PlexLibrary[] {
    return this.activeLibraries.filter(l => l.type === 'movie');
  }

  get activeOtherLibraries(): PlexLibrary[] {
    return this.activeLibraries.filter(l => l.type !== 'movie');
  }

  private loadActiveServer(): void {
    this.jellyfinService.getActiveServer().subscribe({
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
