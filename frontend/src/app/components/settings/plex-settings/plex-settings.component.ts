import { Component, OnInit } from '@angular/core';
import { PlexService } from '../../../services/plex.service';

@Component({
    selector: 'app-plex-settings',
    templateUrl: './plex-settings.component.html',
    styleUrls: ['./plex-settings.component.scss'],
    standalone: false
})
export class PlexSettingsComponent implements OnInit {
  // State
  servers: string[] = [];
  selectedServer = '';
  plexToken = '';
  libraries: string[] = [];

  // Active server
  activeServer = '';
  activeLibraryCount = 0;
  hasActiveServer = false;

  // UI state
  step: 'idle' | 'authenticating' | 'waiting' | 'fetching' | 'selecting' | 'saving' = 'idle';
  tokenVisible = false;
  statusMessage = '';
  statusType: 'success' | 'error' | '' = '';

  constructor(private plexService: PlexService) {}

  ngOnInit(): void {
    this.loadActiveServer();
  }

  connectPlex(): void {
    this.step = 'authenticating';
    this.clearMessage();
    this.plexService.authenticate().subscribe({
      next: (res) => {
        if (res.oauth_url) {
          window.open(res.oauth_url, '_blank');
          this.step = 'waiting';
        }
      },
      error: () => {
        this.showMessage('Failed to start Plex authentication.', 'error');
        this.step = 'idle';
      }
    });
  }

  fetchServers(): void {
    this.step = 'fetching';
    this.clearMessage();
    this.plexService.fetchServers().subscribe({
      next: (res) => {
        this.servers = res.servers || [];
        this.plexToken = res.token || '';
        if (this.servers.length > 0) {
          this.step = 'selecting';
          if (this.servers.length === 1) {
            this.selectedServer = this.servers[0];
            this.onServerSelect();
          }
        } else {
          this.showMessage('No servers found. Complete the Plex login first.', 'error');
          this.step = 'waiting';
        }
      },
      error: () => {
        this.showMessage('Failed to fetch servers. Try authenticating again.', 'error');
        this.step = 'idle';
      }
    });
  }

  onServerSelect(): void {
    if (!this.selectedServer) return;
    this.step = 'fetching';
    this.libraries = [];
    this.plexService.fetchLibraries(this.selectedServer).subscribe({
      next: (res: any) => {
        if (res.libraries && Array.isArray(res.libraries)) {
          this.libraries = res.libraries;
        }
        if (res.token) {
          this.plexToken = res.token;
        }
        this.step = 'selecting';
      },
      error: () => {
        this.showMessage('Failed to fetch libraries.', 'error');
        this.step = 'selecting';
      }
    });
  }

  setAsActive(): void {
    if (!this.selectedServer || !this.plexToken) return;
    this.step = 'saving';
    this.clearMessage();
    this.plexService.saveData(this.selectedServer, this.plexToken, this.libraries).subscribe({
      next: () => {
        this.showMessage('Server saved successfully!', 'success');
        this.step = 'idle';
        this.servers = [];
        this.libraries = [];
        this.selectedServer = '';
        this.loadActiveServer();
      },
      error: () => {
        this.showMessage('Failed to save server.', 'error');
        this.step = 'selecting';
      }
    });
  }

  disconnect(): void {
    this.hasActiveServer = false;
    this.activeServer = '';
    this.activeLibraryCount = 0;
    this.step = 'idle';
    this.clearMessage();
  }

  togglePlexTokenVisibility(): void {
    this.tokenVisible = !this.tokenVisible;
  }

  get isLoading(): boolean {
    return this.step === 'authenticating' || this.step === 'fetching' || this.step === 'saving';
  }

  private loadActiveServer(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        if (res && res.server) {
          this.hasActiveServer = true;
          this.activeServer = res.server;
          // libraries is stored as {serverName: [lib1, lib2, ...]}
          if (res.libraries && typeof res.libraries === 'object') {
            const libs = Object.values(res.libraries).flat();
            this.activeLibraryCount = libs.length;
          } else {
            this.activeLibraryCount = 0;
          }
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
