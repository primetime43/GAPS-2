import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CollectionGap } from '../models/recommendation.model';
import { PersonResult, PersonDetails } from '../models/actor.model';

/**
 * Actor/actress gap finding (issue #49). Unlike the movie/TV scans this is a
 * synchronous, search-driven lookup: search a person, then fetch their owned vs.
 * missing filmography. Results reuse the movie CollectionGap shape, so the
 * existing Gap normalization, export, and Radarr send all apply unchanged.
 */
@Injectable({ providedIn: 'root' })
export class ActorService {
  constructor(private http: HttpClient) {}

  searchPeople(query: string): Observable<PersonResult[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<{ results: PersonResult[] }>(
      `${environment.apiUrl}/actors/search`, { params }
    ).pipe(map(res => res.results));
  }

  /** Suggested actors for the empty-search grid, from popular movies or TV
   * shows depending on the active tab. `refreshedAt`/`nextRefreshAt` are Unix
   * epochs (seconds) for when the list was built and when it goes stale (null if
   * unavailable). `force=true` bypasses the server cache and rebuilds now. */
  getPopular(mediaType: 'movie' | 'tv' = 'movie', force = false):
    Observable<{ people: PersonResult[]; refreshedAt: number | null; nextRefreshAt: number | null }> {
    let params = new HttpParams().set('mediaType', mediaType);
    if (force) params = params.set('refresh', 'true');
    return this.http.get<{ results: PersonResult[]; refreshedAt: number | null; nextRefreshAt: number | null }>(
      `${environment.apiUrl}/actors/popular`, { params }
    ).pipe(map(res => ({
      people: res.results,
      refreshedAt: res.refreshedAt ?? null,
      nextRefreshAt: res.nextRefreshAt ?? null,
    })));
  }

  getActorGaps(
    personId: number,
    libraryNames: string[],
    source: string = 'plex',
    showExisting: boolean = true,
    includeMinor: boolean = false,
    mediaType: 'movie' | 'tv' = 'movie',
    includeImdbRatings: boolean = false,
  ): Observable<{ gaps: CollectionGap[]; actor: PersonDetails | null }> {
    let params = new HttpParams()
      .set('source', source)
      .set('showExisting', showExisting.toString())
      .set('includeMinor', includeMinor.toString())
      .set('mediaType', mediaType)
      .set('includeImdbRatings', includeImdbRatings.toString());
    for (const lib of libraryNames) {
      params = params.append('libraryNames', lib);
    }
    return this.http.get<{ gaps: CollectionGap[]; actor: PersonDetails | null }>(
      `${environment.apiUrl}/actors/${personId}/gaps`, { params }
    );
  }
}
