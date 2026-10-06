import { Subscription } from 'rxjs';
import { Gap } from '../models/recommendation.model';
import { GapViewService } from './gap-view.service';

/** Per-view loading state backed by the shared rating fetch and mapping. */
export class ImdbRatingsLoader {
  loading = false;
  loaded = false;
  error = '';
  ratingCount = 0;
  private request?: Subscription;

  constructor(private gapView: GapViewService) {}

  load(gaps: Gap[], onLoaded: () => void, retry = false, mediaType: 'movie' | 'tv' = 'movie'): void {
    if (!gaps.length || this.loading || (this.loaded && !retry)) return;
    this.loading = true;
    this.error = '';
    this.request = this.gapView.applyImdbRatings(gaps, mediaType === 'tv' ? { suppressErrors: false, mediaType } : { suppressErrors: false }).subscribe({
      next: () => {
        this.loading = false;
        this.loaded = true;
        this.ratingCount = gaps.filter(gap => gap.imdbRating != null).length;
        onLoaded();
      },
      error: () => {
        this.loading = false;
        this.error = 'Could not load IMDb ratings. You can still open titles on IMDb.';
      },
    });
  }

  /** Cancel when replacing results or destroying the owning view. */
  reset(): void {
    this.request?.unsubscribe();
    this.request = undefined;
    this.loading = false;
    this.loaded = false;
    this.error = '';
    this.ratingCount = 0;
  }
}
