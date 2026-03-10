import { Component, OnInit } from '@angular/core';
import { PlexService } from '../../../services/plex.service';

@Component({
    selector: 'app-plex-settings',
    templateUrl: './plex-settings.component.html',
    styleUrls: ['./plex-settings.component.scss'],
    standalone: false
})
export class PlexSettingsComponent implements OnInit {
  servers: string[] = [];
  selectedServer = '';
  plexToken = '';
  tokenVisible = false;
  libraries: string[] = [];
  librariesData: Record<string, string[]> = {};
  showSavePlexData = false;
  activeServerInfo = '';
  statusMessage = '';
  statusType: 'success' | 'error' | '' = '';
  loading = false;

  constructor(private plexService: PlexService) {}

  ngOnInit(): void {
    this.loadActiveServer();
  }

  authenticatePlexAccount(): void {
    this.loading = true;
    this.clearMessage();
    this.plexService.authenticate().subscribe({
      next: (res) => {
        if (res.oauth_url) {
          window.open(res.oauth_url, '_blank');
          this.showMessage('Plex authentication window opened. Complete login, then click "Fetch Servers".', 'success');
        }
        this.loading = false;
      },
      error: () => {
        this.showMessage('Failed to authenticate with Plex. Please try again.', 'error');
        this.loading = false;
      }
    });
  }

  fetchServers(): void {
    this.loading = true;
    this.clearMessage();
    this.plexService.fetchServers().subscribe({
      next: (res) => {
        this.servers = res.servers || [];
        this.plexToken = res.token || '';
        if (this.servers.length > 0) {
          this.showMessage(`Found ${this.servers.length} server(s).`, 'success');
        } else {
          this.showMessage('No servers found. Make sure you have authenticated.', 'error');
        }
        this.loading = false;
      },
      error: () => {
        this.showMessage('Failed to fetch servers. Authenticate first.', 'error');
        this.loading = false;
      }
    });
  }

  onServerSelect(): void {
    if (!this.selectedServer) return;
    this.loading = true;
    this.clearMessage();
    this.plexService.fetchLibraries(this.selectedServer).subscribe({
      next: (res: any) => {
        if (res.libraries && Array.isArray(res.libraries)) {
          this.libraries = res.libraries;
        } else if (typeof res === 'object') {
          this.librariesData = res;
          this.libraries = Object.keys(res);
        }
        if (res.token) {
          this.plexToken = res.token;
        }
        this.showSavePlexData = true;
        this.showMessage(`Found ${this.libraries.length} library/libraries on ${this.selectedServer}.`, 'success');
        this.loading = false;
      },
      error: () => {
        this.showMessage('Failed to fetch libraries for selected server.', 'error');
        this.loading = false;
      }
    });
  }

  togglePlexTokenVisibility(): void {
    this.tokenVisible = !this.tokenVisible;
  }

  setAsActivePlexServer(): void {
    if (!this.selectedServer || !this.plexToken) return;
    this.loading = true;
    this.clearMessage();
    this.plexService.saveData(this.selectedServer, this.plexToken, this.librariesData).subscribe({
      next: () => {
        this.showMessage(`${this.selectedServer} set as active Plex server!`, 'success');
        this.loading = false;
        this.loadActiveServer();
      },
      error: () => {
        this.showMessage('Failed to save server data.', 'error');
        this.loading = false;
      }
    });
  }

  loadActiveServer(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        if (res && res.server) {
          const libCount = res.libraries ? Object.keys(res.libraries).length : 0;
          this.activeServerInfo = `Active: ${res.server} (${libCount} libraries)`;
        } else {
          this.activeServerInfo = 'No active server configured.';
        }
      },
      error: () => {
        this.activeServerInfo = 'No active server configured.';
      }
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
