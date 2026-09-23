import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { ActorsComponent } from './actors.component';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';
import { CompactNumberPipe } from '../../pipes/compact-number.pipe';
import { ActiveServerService } from '../../services/active-server.service';
import { ActorService } from '../../services/actor.service';
import { PreferencesService, DEFAULT_PREFERENCES } from '../../services/preferences.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TvdbService } from '../../services/tvdb.service';
import { RadarrService } from '../../services/radarr.service';
import { SonarrService } from '../../services/sonarr.service';
import { TmdbService } from '../../services/tmdb/tmdb.service';

describe('ActorsComponent', () => {
  let fixture: ComponentFixture<ActorsComponent>;
  let component: ActorsComponent;
  let actors: jasmine.SpyObj<ActorService>;
  let preferences: jasmine.SpyObj<PreferencesService>;
  let tvdb: jasmine.SpyObj<TvdbService>;
  let tmdb: jasmine.SpyObj<TmdbService>;
  const actor = { id: 1, name: 'Test Actor', profileUrl: null, knownFor: '' };
  const credit = { tmdbId: 101, name: 'Test title', year: 2020, releaseDate: '2020-01-01', voteAverage: 8, voteCount: 100 };

  beforeEach(async () => {
    actors = jasmine.createSpyObj('ActorService', ['getPopular', 'searchPeople', 'getActorGaps']);
    actors.getPopular.and.returnValue(of({ people: [actor], refreshedAt: null, nextRefreshAt: null }));
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [credit] } as any));
    preferences = jasmine.createSpyObj('PreferencesService', ['load', 'save']);
    preferences.load.and.returnValue(of({ ...DEFAULT_PREFERENCES }));
    preferences.save.and.returnValue(of({ ...DEFAULT_PREFERENCES }));
    tvdb = jasmine.createSpyObj('TvdbService', ['getIgnored', 'addIgnoredBulk', 'addIgnored']);
    tvdb.getIgnored.and.returnValue(of([]));
    tvdb.addIgnoredBulk.and.returnValue(of({} as any));
    tmdb = jasmine.createSpyObj('TmdbService', ['getGenres']);
    tmdb.getGenres.and.returnValue(of([]));
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule, FormsModule],
      declarations: [ActorsComponent, ConfirmModalComponent, CompactNumberPipe],
      providers: [
        { provide: ActorService, useValue: actors },
        { provide: PreferencesService, useValue: preferences },
        { provide: TvdbService, useValue: tvdb },
        { provide: TmdbService, useValue: tmdb },
        { provide: ActiveServerService, useValue: { getActive: () => of({
          source: 'jellyfin', server: 'Test server', libraries: [
            { title: 'Movies', type: 'movie' }, { title: 'More movies', type: 'movies' },
            { title: 'TV', type: 'tvshows' },
          ],
        }) } },
        { provide: RecommendationService, useValue: { getIgnored: () => of([]) } },
        { provide: RadarrService, useValue: { getConfig: () => of({ enabled: false }) } },
        { provide: SonarrService, useValue: { getConfig: () => of({ enabled: false }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ActorsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows even a single TV library and preserves selections between tabs', () => {
    component.toggleLibrarySelection('More movies');
    component.setMediaType('tv');
    fixture.detectChanges();
    expect(component.selectedLibraries).toEqual(['TV']);
    const checkbox = fixture.nativeElement.querySelector('[id="actor-lib-TV"]');
    expect(checkbox.checked).toBeTrue();
    expect(checkbox.disabled).toBeTrue();
    component.toggleLibrarySelection('TV');
    expect(component.selectedLibraries).toEqual(['TV']);
    component.setMediaType('movie');
    expect(component.selectedLibraries).toEqual(['Movies']);
  });

  it('switches a selected actor from TV to movies and back without searching again', () => {
    component.toggleLibrarySelection('More movies');
    component.setMediaType('tv');
    component.selectActor(actor);
    component.resultFilter = 'TV title';
    component.genreFilter = 18;
    component.setView('missing');
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button');
    buttons[0].click();
    fixture.detectChanges();
    expect(component.selectedActor).toBe(actor);
    expect(actors.getActorGaps).toHaveBeenCalledWith(actor.id, ['Movies'], 'jellyfin', true, false, 'movie', false);
    expect(actors.searchPeople).not.toHaveBeenCalled();
    expect(component.resultFilter).toBe('');
    expect(component.genreFilter).toBeNull();
    expect(component.view).toBe('missing');
    expect(component.downloaderName).toBe('Radarr');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('.rec-title-link')).not.toBeNull();

    buttons[1].click();
    fixture.detectChanges();
    expect(component.selectedActor).toBe(actor);
    expect(actors.getActorGaps).toHaveBeenCalledWith(actor.id, ['TV'], 'jellyfin', true, false, 'tv', false);
    expect(component.downloaderName).toBe('Sonarr');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the media switch available during loading, empty results and errors', () => {
    const pending = new Subject<any>();
    actors.getActorGaps.and.returnValue(pending);
    component.selectActor(actor);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button').length).toBe(2);

    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [] }));
    fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button')[1].click();
    fixture.detectChanges();
    expect(component.mediaType).toBe('tv');
    expect(fixture.nativeElement.textContent).toContain('No TV shows to show');
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button').length).toBe(2);

    actors.getActorGaps.and.returnValue(throwError(() => ({ error: { error: 'Library unavailable' } })));
    fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button')[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Library unavailable');
    expect(fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button').length).toBe(2);
    expect(component.selectedActor).toBe(actor);
  });

  it('only offers the movie rating provider that is actually populated', () => {
    component.selectActor(actor);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#actorShowImdb')).toBeNull();
    expect(fixture.nativeElement.querySelector('#actorShowTmdb')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.rating-chip.tmdb')).not.toBeNull();
  });

  it('uses TVDB/IMDb links and only IMDb ratings for TV cards', () => {
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [
      { ...credit, tvdbId: 201, imdbId: 'tt123', imdbRating: 8.5, imdbVotes: 200 },
    ] } as any));
    component.setMediaType('tv');
    component.showImdbRatings = true;
    component.selectActor(actor);
    fixture.detectChanges();
    expect(component.allGaps[0].externalUrl).toBe('https://thetvdb.com/dereferrer/series/201');
    expect(fixture.nativeElement.querySelector('#actorShowTmdb')).toBeNull();
    expect(fixture.nativeElement.querySelector('.rating-chip.tmdb')).toBeNull();
    expect(fixture.nativeElement.querySelector('.rating-chip.imdb')).not.toBeNull();
    component.tvLinkProvider = 'imdb';
    component.onLinkProviderChange();
    expect(component.allGaps[0].externalUrl).toBe('https://www.imdb.com/title/tt123/');
    expect(preferences.save).toHaveBeenCalledWith({ actorTvLinkProvider: 'imdb' });
    expect(component.externalLinkProvider).toBe('tmdb');
  });

  it('falls back to IMDb, then TMDB when a TVDB ID is missing', () => {
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [
      { ...credit, imdbId: 'tt123' }, { ...credit, tmdbId: 102 },
    ] } as any));
    component.setMediaType('tv');
    component.selectActor(actor);
    expect(component.allGaps.map(g => g.externalUrl)).toEqual([
      'https://www.imdb.com/title/tt123/', 'https://www.themoviedb.org/tv/102',
    ]);
  });

  it('fetches TV ratings when enabled after results are loaded', () => {
    component.setMediaType('tv');
    component.selectActor(actor);
    component.showImdbRatings = true;
    component.onRatingPrefsChange();
    expect(actors.getActorGaps).toHaveBeenCalledWith(1, ['TV'], 'jellyfin', true, false, 'tv', true);
  });

  it('never ignores a TV show using its fallback TMDB ID', () => {
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [
      { ...credit }, { ...credit, tmdbId: 102, tvdbId: 101 },
    ] } as any));
    component.setMediaType('tv');
    component.selectActor(actor);
    const [unmapped, mapped] = component.allGaps;
    component.ignoredIds = new Set([101]);
    expect(component.isIgnored(unmapped)).toBeFalse();
    expect(component.isIgnored(mapped)).toBeTrue();
    expect(component.trackByGapId(0, unmapped)).not.toBe(component.trackByGapId(1, mapped));
    component.toggleIgnore(unmapped, new Event('click'));
    expect(component.pendingIgnoreGap).toBeNull();
    component.ignoredIds.clear();
    component.ignoreAll({ name: actor.name, gaps: component.allGaps }, new Event('click'));
    expect(tvdb.addIgnoredBulk).toHaveBeenCalledOnceWith([101]);
  });

  it('keeps controls visible when filters or title search hide every result', () => {
    component.selectActor(actor);
    component.setView('owned');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#actorShowFuture')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No movies to show');
    component.setView('all');
    component.resultFilter = 'no match';
    component.applyFilter();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No movies to show');
  });

  it('uses the selected genre for counts and requests TV genres on tab change', () => {
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [
      { ...credit, genreIds: [18] }, { ...credit, tmdbId: 102, genreIds: [35] },
    ] } as any));
    component.selectActor(actor);
    component.genreFilter = 18;
    component.applyFilter();
    expect(component.missingCount).toBe(1);
    component.clearActor();
    component.setMediaType('tv');
    expect(component.genreFilter).toBeNull();
    expect(tmdb.getGenres).toHaveBeenCalledWith('tv');
  });

  it('ignores late results from an actor cleared while loading', () => {
    const pending = new Subject<any>();
    actors.getActorGaps.and.returnValue(pending);
    component.selectActor(actor);
    component.clearActor();
    pending.next({ actor: null, gaps: [credit] });
    expect(component.allGaps).toEqual([]);
    expect(component.loadingGaps).toBeFalse();
  });

  it('does not replace TV results with a late movie response after switching tabs', () => {
    const pending = new Subject<any>();
    actors.getActorGaps.and.returnValue(pending);
    component.selectActor(actor);
    actors.getActorGaps.and.returnValue(of({ actor: null, gaps: [{ ...credit, tvdbId: 201 }] } as any));
    component.setMediaType('tv');
    pending.next({ actor: null, gaps: [{ ...credit, tmdbId: 999 }] });
    expect(component.allGaps[0].tvdbId).toBe(201);
    expect(component.allGaps[0].tmdbId).toBe(101);
  });

  it('does not let late movie suggestions overwrite TV suggestions', () => {
    const pending = new Subject<any>();
    actors.getPopular.and.returnValue(pending);
    component.refreshPopular();
    actors.getPopular.and.returnValue(of({ people: [{ ...actor, name: 'TV Actor' }], refreshedAt: null, nextRefreshAt: null }));
    component.setMediaType('tv');
    pending.next({ people: [actor], refreshedAt: null, nextRefreshAt: null });
    expect(component.popularActors[0].name).toBe('TV Actor');
    expect(component.refreshingPopular).toBeFalse();
  });

  it('reports library errors and still provides a Back button', () => {
    actors.getActorGaps.and.returnValue(throwError(() => ({ error: { error: 'Library unavailable' } })));
    component.selectActor(actor);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Library unavailable');
    expect(fixture.nativeElement.textContent).toContain('Back');
  });

  it('uses the release year for dateless movies like the Missing page', () => {
    component.selectActor(actor);
    expect(component.isFutureRelease({ ...component.allGaps[0], releaseDate: undefined, year: 2000 })).toBeFalse();
  });
});
