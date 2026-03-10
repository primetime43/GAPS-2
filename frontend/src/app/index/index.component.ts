import { Component, OnInit } from '@angular/core';
import { TmdbService } from '../services/tmdb/tmdb.service';
import { PlexService } from '../services/plex.service';

@Component({
    selector: 'app-index',
    templateUrl: './index.component.html',
    styleUrls: ['./index.component.scss'],
    standalone: false
})
export class IndexComponent implements OnInit {
  tmdbConfigured = false;
  plexConnected = false;
  plexServerName = '';
  loading = true;

  constructor(
    private tmdbService: TmdbService,
    private plexService: PlexService
  ) {}

  ngOnInit(): void {
    this.tmdbConfigured = this.tmdbService.hasApiKey();

    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        this.plexConnected = !!(res && res.server);
        this.plexServerName = res?.server || '';
        this.loading = false;
      },
      error: () => {
        this.plexConnected = false;
        this.loading = false;
      }
    });
  }
}
