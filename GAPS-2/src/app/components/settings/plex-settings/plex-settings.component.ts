import { Component } from '@angular/core';

@Component({
  selector: 'app-plex-settings',
  templateUrl: './plex-settings.component.html'
})
export class PlexSettingsComponent {
  servers: string[] = [];  // populate from your API
  selectedServer: string;
  plexToken: string;
  showSavePlexData = false;  // Show/hide the 'Set As Active Plex Server' button
  showActiveServerBtn = false;  // Show/hide the 'Show Active Server' button
  activeServerInfo: string;

  authenticatePlexAccount() {
    // Your code here
  }

  fetchServers() {
    // Your code here
  }

  togglePlexTokenVisibility() {
    // Your code here
  }

  savePlexServer() {
    // Your code here
  }

  setAsActivePlexServer() {
    // Your code here
  }

  showActiveServer() {
    // Your code here
  }
}
