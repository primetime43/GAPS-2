import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Gap } from '../models/recommendation.model';
import { TmdbGenre } from './tmdb/tmdb.service';
import { ImdbService } from './imdb.service';

export type RatingSource = 'tmdb' | 'imdb';
export type SortDirection = 'asc' | 'desc';
export type GapSortKey = 'default' | 'rating' | 'votes' | 'year' | 'name';

/**
 * Shared logic for the gap result grids used by both the Missing/Recommended
 * view and the Actors filmography view. These two components present the same
 * `Gap[]` the same way (sort, genre filter, on-demand IMDb ratings), so the
 * behavior lives here once instead of being copy-pasted into each.
 */
@Injectable({ providedIn: 'root' })
export class GapViewService {
  constructor(private imdbService: ImdbService) {}

  /** An explicit source never falls back to another provider. */
  ratingOf(g: Gap, source?: RatingSource): number {
    if (source === 'imdb') return g.imdbRating ?? 0;
    if (source === 'tmdb') return g.tmdbRating ?? 0;
    return g.imdbRating ?? g.tmdbRating ?? 0;
  }

  /** Vote count paired with the rating returned by ratingOf. */
  votesOf(g: Gap, source?: RatingSource): number {
    if (source === 'imdb') return g.imdbVotes ?? 0;
    if (source === 'tmdb') return g.tmdbVotes ?? 0;
    return g.imdbRating != null ? (g.imdbVotes ?? 0) : (g.tmdbVotes ?? 0);
  }

  yearNum(g: Gap): number {
    const y = parseInt(String(g.year), 10);
    return isNaN(y) ? 0 : y;
  }

  /** Sort a copy of the list by the selected key, leaving the source untouched. */
  sortGaps(list: Gap[], sortBy: GapSortKey, source?: RatingSource,
           direction: SortDirection = sortBy === 'name' ? 'asc' : 'desc'): Gap[] {
    const sign = direction === 'asc' ? 1 : -1;
    // Missing metadata stays last in either direction; actual zeroes are valid.
    const compare = (a: number | undefined, b: number | undefined): number => {
      if (a == null) return b == null ? 0 : 1;
      if (b == null) return -1;
      return sign * (a - b);
    };
    const rating = (g: Gap) => source === 'imdb' ? g.imdbRating
      : source === 'tmdb' ? g.tmdbRating : (g.imdbRating ?? g.tmdbRating);
    const votes = (g: Gap) => source === 'imdb' ? g.imdbVotes
      : source === 'tmdb' ? g.tmdbVotes : (g.imdbRating != null ? g.imdbVotes : g.tmdbVotes);
    const year = (g: Gap) => this.yearNum(g) > 0 ? this.yearNum(g) : undefined;
    switch (sortBy) {
      case 'rating': return [...list].sort((a, b) => compare(rating(a), rating(b)));
      case 'votes': return [...list].sort((a, b) => compare(votes(a), votes(b)));
      case 'year': return [...list].sort((a, b) => compare(year(a), year(b)));
      case 'name': return [...list].sort((a, b) => sign * String(a.name).localeCompare(String(b.name)));
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
   * once when done. Callers with a retry UI can opt into error reporting.
   * Resolving each title's IMDb id requires a cached TMDB lookup.
   */
  applyImdbRatings(gaps: Gap[], options: { suppressErrors?: boolean } = {}): Observable<void> {
    const ids = gaps.map(g => g.id).filter((id): id is number => !!id);
    if (!ids.length) return of(undefined);
    return this.imdbService.getRatings(ids).pipe(
      map(res => {
        const ratings = res.ratings || {};
        for (const gap of gaps) {
          const r = ratings[String(gap.id)];
          if (r) {
            gap.imdbId = r.imdbId;
            gap.imdbRating = r.aggregateRating;
            gap.imdbVotes = r.voteCount;
          }
        }
      }),
      catchError(error => options.suppressErrors === false
        ? throwError(() => error)
        : of(undefined)),
    );
  }
}
