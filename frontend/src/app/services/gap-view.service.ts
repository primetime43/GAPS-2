import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Gap } from '../models/recommendation.model';
import { TmdbGenre } from './tmdb/tmdb.service';
import { ImdbService } from './imdb.service';

export type GapSortKey = 'default' | 'rating' | 'popularity' | 'year' | 'name';

/**
 * Shared logic for the gap result grids used by both the Missing/Recommended
 * view and the Actors filmography view. These two components present the same
 * `Gap[]` the same way (sort, genre filter, on-demand IMDb ratings), so the
 * behavior lives here once instead of being copy-pasted into each.
 */
@Injectable({ providedIn: 'root' })
export class GapViewService {
  constructor(private imdbService: ImdbService) {}

  /** Displayed rating used for sorting: IMDb when present, else TMDB. */
  ratingOf(g: Gap): number {
    return g.imdbRating ?? g.tmdbRating ?? 0;
  }

  yearNum(g: Gap): number {
    const y = parseInt(String(g.year), 10);
    return isNaN(y) ? 0 : y;
  }

  /** Sort a copy of the list by the selected key, leaving the source untouched. */
  sortGaps(list: Gap[], sortBy: GapSortKey): Gap[] {
    switch (sortBy) {
      case 'rating': return [...list].sort((a, b) => this.ratingOf(b) - this.ratingOf(a));
      case 'popularity': return [...list].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
      case 'year': return [...list].sort((a, b) => this.yearNum(b) - this.yearNum(a));
      case 'name': return [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      default: return list;
    }
  }

  /** Genres actually present in the given gaps, for the filter dropdown. */
  availableGenres(gaps: Gap[], genres: TmdbGenre[]): TmdbGenre[] {
    if (!genres.length || !gaps.length) return [];
    const present = new Set<number>();
    for (const g of gaps) (g.genreIds || []).forEach(id => present.add(id));
    return genres
      .filter(gen => present.has(gen.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Fetch IMDb ratings for the given movie gaps and patch them in place, emitting
   * once when done (errors are swallowed to an empty result). The backend returns
   * nothing unless the IMDb integration is enabled. Resolving each title's IMDb id
   * is a per-movie TMDB lookup, so callers invoke this on demand, not on load.
   */
  applyImdbRatings(gaps: Gap[]): Observable<void> {
    const ids = gaps.map(g => g.id).filter((id): id is number => !!id);
    if (!ids.length) return of(undefined);
    return this.imdbService.getRatings(ids).pipe(
      catchError(() => of({ ratings: {} as Record<string, any> })),
      map(res => {
        const ratings = res.ratings || {};
        for (const gap of gaps) {
          const r = ratings[String(gap.id)];
          if (r) {
            gap.imdbRating = r.aggregateRating;
            gap.imdbVotes = r.voteCount;
          }
        }
      }),
    );
  }
}
