import { of } from 'rxjs';
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
});
