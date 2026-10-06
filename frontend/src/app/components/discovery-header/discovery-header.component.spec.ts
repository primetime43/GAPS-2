import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoveryHeaderComponent } from './discovery-header.component';

describe('DiscoveryHeaderComponent', () => {
  let fixture: ComponentFixture<DiscoveryHeaderComponent<string, string>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DiscoveryHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(DiscoveryHeaderComponent);
    fixture.componentRef.setInput('idPrefix', 'test');
    fixture.componentRef.setInput('title', 'Test results');
    fixture.componentRef.setInput('sortBy', 'year');
    fixture.componentRef.setInput('linkProvider', 'tmdb');
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('keeps search, sorting, and filters available with zero results', () => {
    expect(fixture.nativeElement.querySelector('.result-controls input')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.result-sort').value).toBe('year');
    expect(fixture.nativeElement.querySelector('#testMinRating')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('All');
    expect(fixture.nativeElement.textContent).toContain('(0)');
    const change = spyOn(fixture.componentInstance.viewChange, 'emit');
    fixture.nativeElement.querySelectorAll('[aria-label="Owned or missing"] button')[2].click();
    expect(change).toHaveBeenCalledWith('missing');
  });

  it('shares the introduction, media switch, and library selection without showing result controls', () => {
    fixture.componentRef.setInput('section', 'intro');
    fixture.componentRef.setInput('description', 'Choose your libraries.');
    fixture.componentRef.setInput('showMediaToggle', true);
    fixture.componentRef.setInput('libraries', [{ title: 'Movies', type: 'movie' }, { title: '4K', type: 'movie' }]);
    fixture.componentRef.setInput('selectedLibraries', ['Movies']);
    fixture.componentRef.setInput('requireLibrary', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h3').textContent).toBe('Test results');
    expect(fixture.nativeElement.textContent).toContain('Choose your libraries.');
    expect(fixture.nativeElement.querySelector('.result-controls')).toBeNull();
    expect(fixture.nativeElement.querySelector('#test-lib-Movies').disabled).toBeTrue();
    const library = spyOn(fixture.componentInstance.libraryToggle, 'emit');
    fixture.nativeElement.querySelector('#test-lib-4K').click();
    expect(library).toHaveBeenCalledWith('4K');
    expect(fixture.componentInstance.selectedLibraries).toEqual(['Movies']);
    const media = spyOn(fixture.componentInstance.mediaTypeChange, 'emit');
    fixture.nativeElement.querySelectorAll('[aria-label="Media type"] button')[1].click();
    expect(media).toHaveBeenCalledWith('tv');
  });

  it('shows the empty-library message and keeps busy library selectors disabled', () => {
    fixture.componentRef.setInput('section', 'intro');
    fixture.componentRef.setInput('serverName', 'Test server');
    fixture.componentRef.setInput('mediaType', 'tv');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No TV libraries found on');
    expect(fixture.nativeElement.textContent).toContain('Test server');
    fixture.componentRef.setInput('libraries', [{ title: 'TV', type: 'show' }]);
    fixture.componentRef.setInput('librariesDisabled', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBeTrue();
  });

  it('keeps Back available while loading and hides controls until results arrive', () => {
    fixture.componentRef.setInput('loading', true);
    fixture.componentRef.setInput('loadingMessage', 'Finding titles...');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.result-controls')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Finding titles...');
    const back = spyOn(fixture.componentInstance.back, 'emit');
    fixture.nativeElement.querySelector('.result-toolbar button').click();
    expect(back).toHaveBeenCalled();
  });

  it('shows meaningful direction choices and hides them for default or relevance ordering', async () => {
    expect(fixture.nativeElement.querySelector('[aria-label="Sort direction"]').value).toBe('desc');
    expect(fixture.nativeElement.textContent).toContain('Ascending (oldest first)');
    const changed = spyOn(fixture.componentInstance.sortDirectionChange, 'emit');
    const select = fixture.nativeElement.querySelector('[aria-label="Sort direction"]');
    select.value = 'asc';
    select.dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledWith('asc');
    fixture.componentRef.setInput('sortBy', 'name');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(select.value).toBe('asc');
    expect(fixture.nativeElement.textContent).toContain('Descending (Z–A)');
    for (const sort of ['default', 'relevance']) {
      fixture.componentRef.setInput('sortBy', sort);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[aria-label="Sort direction"]')).toBeNull();
    }
  });

  it('normalizes cleared and out-of-range rating limits from the inputs', () => {
    const rating = spyOn(fixture.componentInstance.minRatingChange, 'emit');
    const votes = spyOn(fixture.componentInstance.minVoteCountChange, 'emit');
    const input = fixture.nativeElement.querySelector('#testMinRating');
    input.value = '12';
    input.dispatchEvent(new Event('input'));
    expect(rating).toHaveBeenCalledWith(10);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(rating).toHaveBeenCalledWith(0);
    const voteInput = fixture.nativeElement.querySelector('#testMinVotes');
    voteInput.value = '110.5';
    voteInput.dispatchEvent(new Event('input'));
    expect(votes).toHaveBeenCalledWith(110);
  });

  it('labels sources explicitly and separates the source selector from badge toggles', async () => {
    fixture.componentRef.setInput('ratingSource', 'imdb');
    fixture.componentRef.setInput('sortBy', 'votes');
    fixture.detectChanges();
    await fixture.whenStable();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rating (IMDb)');
    expect(text).toContain('Vote count (IMDb)');
    expect(text.toLowerCase()).not.toContain('popularity');
    expect(text).toContain('Minimum IMDb rating');
    expect(text).toContain('Minimum IMDb votes');
    expect(text).toContain('display only');
    const source = spyOn(fixture.componentInstance.ratingSourceChange, 'emit');
    const select = fixture.nativeElement.querySelector('#testRatingSource');
    select.value = 'tmdb';
    select.dispatchEvent(new Event('change'));
    expect(source).toHaveBeenCalledWith('tmdb');
    expect(fixture.componentInstance.showImdbRatings).toBeFalse();

    fixture.componentRef.setInput('ratingSource', 'tmdb');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Rating (TMDB)');
    expect(fixture.nativeElement.textContent).toContain('Vote count (TMDB)');
    expect(fixture.nativeElement.textContent).not.toContain('Rating (IMDb)');
  });
  it('enforces TV provider visibility centrally and restores movie options on switching back', async () => {
    fixture.componentRef.setInput('mediaType', 'tv');
    fixture.componentRef.setInput('linkProvider', 'imdb');
    fixture.componentRef.setInput('sortOptions', [
      { value: 'relevance', label: 'TMDB relevance' },
      { value: 'rating', label: 'Rating' }, { value: 'votes', label: 'Vote count' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('TMDB');
    expect(fixture.nativeElement.querySelector('#testShowTmdb')).toBeNull();
    expect(fixture.nativeElement.querySelector('#testRatingSource').value).toBe('imdb');
    expect(fixture.nativeElement.querySelector('#testLinkProvider option[value="tmdb"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Minimum IMDb rating');
    fixture.componentRef.setInput('mediaType', 'movie');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('#testShowTmdb')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#testLinkProvider option[value="tmdb"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('TMDB relevance');
    expect(fixture.nativeElement.querySelector('#testRatingSource').value).toBe('tmdb');
  });

});
