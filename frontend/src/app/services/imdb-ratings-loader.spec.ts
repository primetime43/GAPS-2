import { of, Subject, throwError } from 'rxjs';
import { Gap } from '../models/recommendation.model';
import { GapViewService } from './gap-view.service';
import { ImdbRatingsLoader } from './imdb-ratings-loader';

describe('ImdbRatingsLoader', () => {
  let gapView: jasmine.SpyObj<GapViewService>;
  let loader: ImdbRatingsLoader;
  const gaps = [{ id: 1 }, { id: 2, imdbRating: 8 }] as Gap[];

  beforeEach(() => {
    gapView = jasmine.createSpyObj('GapViewService', ['applyImdbRatings']);
    loader = new ImdbRatingsLoader(gapView);
  });

  it('deduplicates active and completed loads while allowing an explicit retry', () => {
    const pending = new Subject<void>();
    const onLoaded = jasmine.createSpy('onLoaded');
    gapView.applyImdbRatings.and.returnValue(pending);
    loader.load([], onLoaded);
    expect(gapView.applyImdbRatings).not.toHaveBeenCalled();
    loader.load(gaps, onLoaded);
    loader.load(gaps, onLoaded, true);
    expect(gapView.applyImdbRatings).toHaveBeenCalledTimes(1);
    pending.next();
    pending.complete();
    expect(loader.loading).toBeFalse();
    expect(loader.loaded).toBeTrue();
    expect(loader.ratingCount).toBe(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    loader.load(gaps, onLoaded);
    expect(gapView.applyImdbRatings).toHaveBeenCalledTimes(1);
    gapView.applyImdbRatings.and.returnValue(of(undefined));
    loader.load(gaps, onLoaded, true);
    expect(gapView.applyImdbRatings).toHaveBeenCalledTimes(2);
  });

  it('reports errors and clears them on a successful retry', () => {
    gapView.applyImdbRatings.and.returnValue(throwError(() => new Error('offline')));
    loader.load(gaps, () => {});
    expect(loader.error).toContain('Could not load IMDb ratings');
    expect(loader.loading).toBeFalse();
    expect(loader.loaded).toBeFalse();
    gapView.applyImdbRatings.and.returnValue(of(undefined));
    loader.load(gaps, () => {}, true);
    expect(loader.error).toBe('');
    expect(loader.loaded).toBeTrue();
  });

  it('cancels old requests on reset and keeps each view independent', () => {
    const pending = new Subject<void>();
    const onLoaded = jasmine.createSpy('onLoaded');
    gapView.applyImdbRatings.and.returnValue(pending);
    loader.load(gaps, onLoaded);
    const other = new ImdbRatingsLoader(gapView);
    expect(other.loading).toBeFalse();
    loader.reset();
    expect(pending.observed).toBeFalse();
    pending.next();
    expect(onLoaded).not.toHaveBeenCalled();
    expect(loader.loading).toBeFalse();
    expect(loader.loaded).toBeFalse();
    expect(loader.ratingCount).toBe(0);
    expect(loader.error).toBe('');
  });
});
