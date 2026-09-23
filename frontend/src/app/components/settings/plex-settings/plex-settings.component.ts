import { Component, OnInit, OnDestroy } from '@angular/core';
import { PlexService } from '../../../services/plex.service';
import { PlexLibrary, PlexConnection } from '../../../models/plex.model';
import { Subject, takeUntil } from 'rxjs';

@Component({
    selector: 'app-plex-settings',
    templateUrl: './plex-settings.component.html',
    styleUrls: ['./plex-settings.component.scss'],
    standalone: false
})
export class PlexSettingsComponent implements OnInit, OnDestroy {
  // State
  servers: string[] = [];
  selectedServer = '';
  plexToken = '';
  libraries: PlexLibrary[] = [];
  librariesLoaded = false;
  oauthUrl = '';

  // Active server
  activeServer = '';
  activeLibraryCount = 0;
  activeLibraries: PlexLibrary[] = [];
  hasActiveServer = false;
  serverExpanded = false;

  // Manual connection
  manualServerUrl = '';
  manualToken = '';
  manualServerName = '';
  connectionMode: 'choose' | 'oauth' | 'manual' = 'choose';

  // Connection URLs
  connections: PlexConnection[] = [];
  selectedConnectionUrl = '';
  serverConnections: { [name: string]: PlexConnection[] } = {};

  // UI state
  step: 'idle' | 'authenticating' | 'waiting' | 'fetching' | 'selecting' | 'saving' | 'manual-connecting' | 'manual-connected' = 'idle';
  tokenVisible = false;
  statusMessage = '';
  statusType: 'success' | 'error' | '' = '';

  testing = false;
  refreshing = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly cancelRequests = new Subject<void>();
  private authDeadline = 0;

  constructor(private plexService: PlexService) {}

  ngOnInit(): void {
    this.loadActiveServer();
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.cancelRequests.complete();
  }

  connectPlex(): void {
    this.stopPolling();
    this.onConnectionChange();
    this.oauthUrl = '';
    this.step = 'authenticating';
    this.clearMessage();
    this.plexService.authenticate().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        if (res.oauth_url) {
          this.oauthUrl = res.oauth_url;
          window.open(res.oauth_url, '_blank', 'noopener,noreferrer');
          this.step = 'waiting';
          this.startPolling();
        } else {
          this.showMessage('Plex did not return a sign-in link. Please try again.', 'error');
          this.step = 'idle';
          this.connectionMode = 'choose';
        }
      },
      error: () => {
        this.showMessage('Failed to start Plex authentication.', 'error');
        this.step = 'idle';
        this.connectionMode = 'choose';
      }
    });
  }

  fetchServers(): void {
    this.step = 'fetching';
    this.clearMessage();
    this.selectedServer = '';
    this.onConnectionChange();
    this.connections = [];
    this.selectedConnectionUrl = '';
    this.plexService.fetchServers().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        this.servers = res.servers || [];
        this.plexToken = res.token || '';
        this.serverConnections = res.serverConnections || {};
        if (this.servers.length > 0) {
          this.step = 'selecting';
          if (this.servers.length === 1) {
            this.selectedServer = this.servers[0];
            this.connections = this.serverConnections[this.selectedServer] || [];
          }
        } else {
          this.showMessage('No servers found. Please try authenticating again.', 'error');
          this.step = 'idle';
          this.connectionMode = 'choose';
        }
      },
      error: () => {
        this.showMessage('Failed to fetch servers. Try authenticating again.', 'error');
        this.step = 'idle';
        this.connectionMode = 'choose';
      }
    });
  }

  onServerSelect(): void {
    this.onConnectionChange();
    this.connections = this.serverConnections[this.selectedServer] || [];
    this.selectedConnectionUrl = '';
    this.clearMessage();
  }

  onConnectionChange(): void {
    this.libraries = [];
    this.librariesLoaded = false;
    this.clearMessage();
  }

  connectToServer(): void {
    if (!this.selectedServer || this.isLoading) return;
    this.onConnectionChange();
    this.step = 'fetching';
    this.clearMessage();
    this.plexService.fetchLibraries(this.selectedServer, this.selectedConnectionUrl || undefined)
      .pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        if (res.libraries && Array.isArray(res.libraries)) {
          this.libraries = res.libraries;
        }
        if (res.token) {
          this.plexToken = res.token;
        }
        this.librariesLoaded = true;
        this.showMessage(`Connected to ${this.selectedServer}. Review the available libraries below.`, 'success');
        this.step = 'selecting';
      },
      error: (err) => {
        const msg = err.error?.error || 'Failed to connect.';
        this.showMessage(msg, 'error');
        this.step = 'selecting';
      }
    });
  }

  connectManual(): void {
    if (!this.manualServerUrl || !this.manualToken) return;
    this.onConnectionChange();
    this.step = 'manual-connecting';
    this.clearMessage();
    this.plexService.connectManual(this.manualServerUrl.trim(), this.manualToken.trim())
      .pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        if (res.connected) {
          this.manualServerName = res.serverName;
          this.libraries = res.libraries || [];
          this.librariesLoaded = true;
          this.step = 'manual-connected';
        } else {
          this.showMessage(res.error || 'Could not connect to Plex server.', 'error');
          this.step = 'idle';
        }
      },
      error: (err) => {
        const msg = err.error?.error || 'Failed to connect. Check the URL and token.';
        this.showMessage(msg, 'error');
        this.step = 'idle';
      }
    });
  }

  saveManual(): void {
    if (!this.librariesLoaded || this.isLoading) return;
    this.step = 'saving';
    this.clearMessage();
    this.plexService.saveData(this.manualServerName, this.manualToken.trim(), this.libraries, this.manualServerUrl.trim())
      .pipe(takeUntil(this.cancelRequests)).subscribe({
      next: () => {
        this.showMessage('Server saved successfully!', 'success');
        this.step = 'idle';
        this.connectionMode = 'choose';
        this.manualServerUrl = '';
        this.manualToken = '';
        this.manualServerName = '';
        this.libraries = [];
        this.librariesLoaded = false;
        this.loadActiveServer();
      },
      error: () => {
        this.showMessage('Failed to save server.', 'error');
        this.step = 'manual-connected';
      }
    });
  }

  setAsActive(): void {
    if (!this.selectedServer || !this.plexToken || !this.librariesLoaded || this.isLoading) return;
    this.step = 'saving';
    this.clearMessage();
    this.plexService.saveData(this.selectedServer, this.plexToken, this.libraries, this.selectedConnectionUrl || undefined)
      .pipe(takeUntil(this.cancelRequests)).subscribe({
      next: () => {
        this.showMessage('Server saved successfully!', 'success');
        this.step = 'idle';
        this.servers = [];
        this.libraries = [];
        this.librariesLoaded = false;
        this.selectedServer = '';
        this.loadActiveServer();
      },
      error: () => {
        this.showMessage('Failed to save server.', 'error');
        this.step = 'selecting';
      }
    });
  }

  testConnection(): void {
    this.testing = true;
    this.clearMessage();
    this.plexService.testConnection().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        this.testing = false;
        if (res.connected) {
          this.showMessage('Connection successful!', 'success');
        } else {
          this.showMessage(res.error || 'Connection failed.', 'error');
        }
      },
      error: () => {
        this.testing = false;
        this.showMessage('Connection test failed.', 'error');
      }
    });
  }

  refreshConnection(): void {
    // Clear current state and re-enter the setup flow so the user can re-authenticate
    this.disconnect();
    this.showMessage('Please sign in again to refresh your connection.', 'success');
  }

  refreshLibraries(): void {
    this.refreshing = true;
    this.clearMessage();
    this.plexService.refreshConnection().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        this.refreshing = false;
        if (res.connected) {
          this.activeLibraries = res.libraries || [];
          this.activeLibraryCount = this.activeLibraries.length;
          this.showMessage('Libraries refreshed.', 'success');
        } else {
          this.showMessage(res.error || 'Could not refresh libraries.', 'error');
        }
      },
      error: () => {
        this.refreshing = false;
        this.showMessage('Could not refresh libraries. Check the connection or sign in again.', 'error');
      }
    });
  }

  cancelSetup(): void {
    this.stopPolling();
    this.onConnectionChange();
    this.connectionMode = 'choose';
    this.step = 'idle';
    this.oauthUrl = '';
    this.tokenVisible = false;
    this.manualToken = '';
    this.manualServerName = '';
    this.selectedServer = '';
    this.selectedConnectionUrl = '';
    this.servers = [];
    this.connections = [];
    this.loadActiveServer();
  }

  disconnect(): void {
    this.stopPolling();
    this.onConnectionChange();
    this.hasActiveServer = false;
    this.serverExpanded = false;
    this.connectionMode = 'choose';
    this.step = 'idle';
    this.clearMessage();
  }

  removeServer(): void {
    this.plexService.removeServer().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: () => {
        this.hasActiveServer = false;
        this.activeServer = '';
        this.activeLibraryCount = 0;
        this.activeLibraries = [];
        this.serverExpanded = false;
        this.step = 'idle';
        this.showMessage('Server removed.', 'success');
      },
      error: () => {
        this.showMessage('Failed to remove server.', 'error');
      }
    });
  }

  togglePlexTokenVisibility(): void {
    this.tokenVisible = !this.tokenVisible;
  }

  get isLoading(): boolean {
    return this.step === 'authenticating' || this.step === 'fetching' || this.step === 'saving' || this.step === 'manual-connecting';
  }

  get movieLibraries(): PlexLibrary[] {
    return this.libraries.filter(lib => lib.type === 'movie');
  }

  get tvLibraries(): PlexLibrary[] {
    return this.libraries.filter(lib => lib.type === 'show');
  }

  get otherLibraries(): PlexLibrary[] {
    return this.libraries.filter(lib => lib.type !== 'movie' && lib.type !== 'show');
  }

  get activeMovieLibraries(): PlexLibrary[] {
    return this.activeLibraries.filter(lib => lib.type === 'movie');
  }

  get activeTvLibraries(): PlexLibrary[] {
    return this.activeLibraries.filter(lib => lib.type === 'show');
  }

  get activeOtherLibraries(): PlexLibrary[] {
    return this.activeLibraries.filter(lib => lib.type !== 'movie' && lib.type !== 'show');
  }

  private startPolling(): void {
    this.stopPolling();
    this.authDeadline = Date.now() + 120000;
    const poll = () => {
      if (Date.now() >= this.authDeadline) {
        this.stopPolling();
        this.step = 'idle';
        this.connectionMode = 'choose';
        this.showMessage('Plex sign-in timed out. Please try again.', 'error');
        return;
      }
      this.plexService.checkLogin().pipe(takeUntil(this.cancelRequests)).subscribe({
        next: (res) => {
          if (res.authenticated) {
            this.stopPolling();
            this.fetchServers();
          } else {
            // Only schedule next poll after current one completes
            this.pollTimer = setTimeout(poll, 500);
          }
        },
        error: () => {
          this.pollTimer = setTimeout(poll, 1000);
        }
      });
    };
    poll();
  }

  private stopPolling(): void {
    this.cancelRequests.next();
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private loadActiveServer(): void {
    this.plexService.getActiveServer().pipe(takeUntil(this.cancelRequests)).subscribe({
      next: (res) => {
        if (res && res.server) {
          this.hasActiveServer = true;
          this.activeServer = res.server;
          this.activeLibraries = Array.isArray(res.libraries) ? res.libraries : [];
          this.activeLibraryCount = this.activeLibraries.length;
          if (res.token) {
            this.plexToken = res.token;
          }
        } else {
          this.hasActiveServer = false;
          this.activeServer = '';
          this.activeLibraries = [];
          this.activeLibraryCount = 0;
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
