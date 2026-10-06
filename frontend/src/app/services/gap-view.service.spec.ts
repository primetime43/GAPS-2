import { of, throwError } from 'rxjs';
import { Gap } from '../models/recommendation.model';
import { ImdbService } from './imdb.service';
import { GapViewService } from './gap-view.service';

describe('GapViewService', () => {
  let service: GapViewService;
  let imdbService: jasmine.SpyObj<ImdbService>;

  const gap = (overrides: Partial<Gap> = {}): Gap => ({
    id: 1,
    name: 'Movie',
    year: 2024,
    posterUrl: null,
    overview: '',
    groupName: 'Group',
    owned: false,
    externalUrl: '',
    radarrEligible: true,
    sonarrEligible: false,
    ...overrides,
  });

  beforeEach(() => {
    imdbService = jasmine.createSpyObj<ImdbService>('ImdbService', ['getRatings']);
    imdbService.getRatings.and.returnValue(of({ ratings: {} }));
    service = new GapViewService(imdbService);
  });

  it('keeps the vote count paired with the preferred IMDb rating', () => {
    const movie = gap({
      tmdbRating: 8,
      tmdbVotes: 2,
      imdbRating: 4.4,
      imdbVotes: 189,
    });

    expect(service.ratingOf(movie)).toBe(4.4);
    expect(service.votesOf(movie)).toBe(189);
  });

  it('falls back to the TMDB rating and votes when IMDb is unavailable', () => {
    const movie = gap({ tmdbRating: 7, tmdbVotes: 2 });

    expect(service.ratingOf(movie)).toBe(7);
    expect(service.votesOf(movie)).toBe(2);
  });

  it('preserves resolved IMDb IDs along with ratings for direct links', () => {
    const movies = [gap()];
    imdbService.getRatings.and.returnValue(of({ ratings: {
      '1': { imdbId: 'tt1234567', aggregateRating: 7.5, voteCount: 500 },
    } }));
    service.applyImdbRatings(movies).subscribe();
    expect(movies[0].imdbId).toBe('tt1234567');
    expect(movies[0].imdbRating).toBe(7.5);
    expect(movies[0].imdbVotes).toBe(500);
  });

  it('sorts ratings and votes using only the selected provider, with unknowns last', () => {
    const movies = [
      gap({ id: 1, tmdbRating: 9, tmdbVotes: 900, imdbRating: 4, imdbVotes: 10 }),
      gap({ id: 2, tmdbRating: 5, tmdbVotes: 50, imdbRating: 8, imdbVotes: 500 }),
      gap({ id: 3, tmdbRating: 10, tmdbVotes: 1000 }),
      gap({ id: 4, imdbRating: 0, imdbVotes: 0 }),
    ];
    expect(service.sortGaps(movies, 'rating', 'imdb').map(g => g.id)).toEqual([2, 1, 4, 3]);
    expect(service.sortGaps(movies, 'rating', 'tmdb').map(g => g.id)).toEqual([3, 1, 2, 4]);
    expect(service.sortGaps(movies, 'votes', 'imdb').map(g => g.id)).toEqual([2, 1, 4, 3]);
    expect(service.sortGaps(movies, 'votes', 'tmdb').map(g => g.id)).toEqual([3, 1, 2, 4]);
    expect(service.ratingOf(movies[2], 'imdb')).toBe(0);
    expect(service.votesOf(movies[2], 'imdb')).toBe(0);
    expect(movies.map(g => g.id)).toEqual([1, 2, 3, 4]);
  });

  it('reports failures to callers with retry controls while preserving the default behavior', () => {
    const failure = new Error('offline');
    imdbService.getRatings.and.returnValue(throwError(() => failure));
    const handled = jasmine.createSpy('handled');
    service.applyImdbRatings([gap()]).subscribe({ next: handled });
    expect(handled).toHaveBeenCalledWith(undefined);

    const reported = jasmine.createSpy('reported');
    service.applyImdbRatings([gap()], { suppressErrors: false }).subscribe({ error: reported });
    expect(reported).toHaveBeenCalledWith(failure);
  });
});
