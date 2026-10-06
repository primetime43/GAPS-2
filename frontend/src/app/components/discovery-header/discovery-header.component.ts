import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ImdbRatingsLoader } from '../../services/imdb-ratings-loader';
import { MediaLibrary } from '../../models/media-server.model';
import { RatingSource, SortDirection } from '../../services/gap-view.service';

/** Shared introduction/library picker and results toolbar for discovery views.
 * Views retain their data loading, filtering, and saved preferences. */
@Component({
  selector: 'app-discovery-header',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './discovery-header.component.html',
  styleUrls: ['./discovery-header.component.scss'],
})
export class DiscoveryHeaderComponent<Sort extends string, Link extends string> {
  readonly views = ['all', 'owned', 'missing'] as const;
  @Input({ required: true }) idPrefix = '';
  @Input() section: 'intro' | 'results' = 'results';
  @Input() description = '';
  @Input() mediaType: 'movie' | 'tv' = 'movie';
  @Input() showMediaToggle = false;
  @Input() mediaDisabled = false;
  @Input() libraries: MediaLibrary[] = [];
  @Input() selectedLibraries: string[] = [];
  @Input() serverName = '';
  @Input() showLibraries = true;
  @Input() librariesDisabled = false;
  @Input() requireLibrary = false;
  @Input() libraryLabel = 'Check ownership in:';
  @Input() title = '';
  @Input() backLabel = 'Back';
  @Input() loading = false;
  @Input() loadingMessage = '';
  @Input() view: 'all' | 'owned' | 'missing' = 'all';
  @Input() allCount = 0;
  @Input() ownedCount = 0;
  @Input() missingCount = 0;
  @Input() search = '';
  @Input() searchPlaceholder = 'Filter results by title...';
  @Input() sortBy: Sort;
  @Input() sortDirection?: SortDirection;
  @Input() sortOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'default', label: 'Default' },
    { value: 'rating', label: 'Rating' },
    { value: 'votes', label: 'Vote count' },
    { value: 'year', label: 'Year' },
    { value: 'name', label: 'Title' },
  ];
  @Input() showImdbRatings = false;
  @Input() showTmdbRatings = true;
  @Input() allowTmdbRatings = true;
  @Input() showRatingLimits = true;
  @Input() minRating = 0;
  @Input() minVoteCount = 0;
  @Input() ratingSource: RatingSource = 'tmdb';
  @Input() allowTmdbSource = true;
  @Input() ratingsAvailable = true;
  @Input() ratingHelp = 'Set either minimum to 0 to ignore it. Titles without the selected rating or vote count are excluded when that minimum is set.';
  @Input() linkProvider: Link;
  @Input() linkOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: 'tmdb', label: 'TMDB' }, { value: 'imdb', label: 'IMDb' },
  ];
  @Input() showLinkProvider = true;
  @Input() imdbState: ImdbRatingsLoader | null = null;

  @Output() back = new EventEmitter<void>();
  @Output() mediaTypeChange = new EventEmitter<'movie' | 'tv'>();
  @Output() libraryToggle = new EventEmitter<string>();
  @Output() viewChange = new EventEmitter<'all' | 'owned' | 'missing'>();
  @Output() searchChange = new EventEmitter<string>();
  @Output() sortByChange = new EventEmitter<Sort>();
  @Output() sortDirectionChange = new EventEmitter<SortDirection>();
  @Output() showImdbRatingsChange = new EventEmitter<boolean>();
  @Output() showTmdbRatingsChange = new EventEmitter<boolean>();
  @Output() minRatingChange = new EventEmitter<number>();
  @Output() minVoteCountChange = new EventEmitter<number>();
  @Output() ratingSourceChange = new EventEmitter<RatingSource>();
  @Output() linkProviderChange = new EventEmitter<Link>();
  @Output() retryImdb = new EventEmitter<void>();

  get effectiveRatingSource(): RatingSource { return this.mediaType === 'tv' ? 'imdb' : this.ratingSource; }
  get ratingSourceLabel(): string { return this.effectiveRatingSource === 'imdb' ? 'IMDb' : 'TMDB'; }
  get visibleLinkOptions() {
    return this.mediaType === 'tv' ? this.linkOptions.filter(option => option.value !== 'tmdb') : this.linkOptions;
  }


  get effectiveSortDirection(): SortDirection {
    return this.sortDirection ?? (this.sortBy === 'name' ? 'asc' : 'desc');
  }

  directionLabel(direction: SortDirection): string {
    const ascending = direction === 'asc';
    const meaning = this.sortBy === 'name' ? (ascending ? 'A–Z' : 'Z–A')
      : this.sortBy === 'year' ? (ascending ? 'oldest first' : 'newest first')
      : (ascending ? 'low to high' : 'high to low');
    return `${ascending ? 'Ascending' : 'Descending'} (${meaning})`;
  }

  sortLabel(option: { value: string; label: string }): string {
    if (this.mediaType === 'tv' && option.value === 'relevance') return 'Relevance';
    if (!this.ratingsAvailable) return option.label;
    if (option.value === 'rating') return `Rating (${this.ratingSourceLabel})`;
    if (option.value === 'votes') return `Vote count (${this.ratingSourceLabel})`;
    return option.label;
  }

  sortAvailable(value: string): boolean {
    return !((value === 'rating' || value === 'votes') && !this.ratingsAvailable);
  }

  changeMinRating(value: number | null): void {
    this.minRatingChange.emit(Math.min(10, Math.max(0, Number(value) || 0)));
  }

  changeMinVotes(value: number | null): void {
    this.minVoteCountChange.emit(Math.max(0, Math.floor(Number(value) || 0)));
  }
}
