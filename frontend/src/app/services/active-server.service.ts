import { Injectable } from '@angular/core';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PlexService } from './plex.service';
import { JellyfinService } from './jellyfin.service';
import { EmbyService } from './emby.service';
import { ActiveServerResponse, MediaLibrary } from '../models/media-server.model';

export type MediaServerSource = 'plex' | 'jellyfin' | 'emby';

export interface ActiveServer {
  source: MediaServerSource;
  typeLabel: 'Plex' | 'Jellyfin' | 'Emby';
  server: string;
  libraries: MediaLibrary[];
  response: ActiveServerResponse;
}

/**
 * Single source of truth for "which media server is connected?" detection.
 * Several views (dashboard, Missing, preferences, schedule) need this; rather
 * than each fanning out to Plex/Jellyfin/Emby and picking the first active one,
 * they call getActive() here.
 */
@Injectable({ providedIn: 'root' })
export class ActiveServerService {
  constructor(
    private plexService: PlexService,
    private jellyfinService: JellyfinService,
    private embyService: EmbyService,
  ) {}

  /**
   * Probe all media servers and resolve to the first connected one
   * (Plex → Jellyfin → Emby), or null if none is connected.
   */
  getActive(): Observable<ActiveServer | null> {
    return forkJoin({
      plex: this.plexService.getActiveServer().pipe(catchError(() => of(null))),
      jellyfin: this.jellyfinService.getActiveServer().pipe(catchError(() => of(null))),
      emby: this.embyService.getActiveServer().pipe(catchError(() => of(null))),
    }).pipe(
      map((servers) => {
        const candidates: { source: MediaServerSource; typeLabel: ActiveServer['typeLabel']; res: ActiveServerResponse | null }[] = [
          { source: 'plex', typeLabel: 'Plex', res: servers.plex as ActiveServerResponse | null },
          { source: 'jellyfin', typeLabel: 'Jellyfin', res: servers.jellyfin as ActiveServerResponse | null },
          { source: 'emby', typeLabel: 'Emby', res: servers.emby as ActiveServerResponse | null },
        ];
        for (const c of candidates) {
          if (c.res && c.res.server) {
            return {
              source: c.source,
              typeLabel: c.typeLabel,
              server: c.res.server,
              libraries: Array.isArray(c.res.libraries) ? c.res.libraries : [],
              response: c.res,
            };
          }
        }
        return null;
      })
    );
  }
}
