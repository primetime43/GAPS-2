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

  getActorGaps(
    personId: number,
    libraryNames: string[],
    source: string = 'plex',
    showExisting: boolean = true,
    includeMinor: boolean = false,
  ): Observable<{ gaps: CollectionGap[]; actor: PersonDetails | null }> {
    let params = new HttpParams()
      .set('source', source)
      .set('showExisting', showExisting.toString())
      .set('includeMinor', includeMinor.toString());
    for (const lib of libraryNames) {
      params = params.append('libraryNames', lib);
    }
    return this.http.get<{ gaps: CollectionGap[]; actor: PersonDetails | null }>(
      `${environment.apiUrl}/actors/${personId}/gaps`, { params }
    );
  }
}
