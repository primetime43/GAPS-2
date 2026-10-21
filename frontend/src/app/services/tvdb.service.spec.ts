import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TvdbService } from './tvdb.service';
import { environment } from '../../environments/environment';

describe('TvdbService custom lists', () => {
  let service: TvdbService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    service = TestBed.inject(TvdbService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests a selected list with all ownership libraries and exposes the choices', () => {
    const result = { gaps: [], hasOfficialList: false, customLists: [{ id: 17543, name: 'Digimon', url: 'https://thetvdb.com/lists/17543' }] };
    service.getShowGaps(72241, ['Anime', 'TV'], true, 'emby', 17543).subscribe(value => expect(value).toEqual(result));
    const req = http.expectOne(request => request.url === `${environment.apiUrl}/tvdb/show`);
    expect(req.request.params.get('listId')).toBe('17543');
    expect(req.request.params.get('tvdbId')).toBe('72241');
    expect(req.request.params.getAll('libraryNames')).toEqual(['Anime', 'TV']);
    expect(req.request.params.get('showExisting')).toBe('true');
    expect(req.request.params.get('source')).toBe('emby');
    req.flush(result);
  });

  it('omits listId until a custom list is explicitly selected', () => {
    service.getShowGaps(72241, [], true).subscribe();
    const req = http.expectOne(request => request.url === `${environment.apiUrl}/tvdb/show`);
    expect(req.request.params.has('listId')).toBeFalse();
    req.flush({ gaps: [], hasOfficialList: false, customLists: [] });
  });
});
