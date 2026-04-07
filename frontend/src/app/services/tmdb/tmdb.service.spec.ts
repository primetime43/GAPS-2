import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TmdbService, TmdbStatus } from './tmdb.service';
import { environment } from '../../../environments/environment';

describe('TmdbService', () => {
  let service: TmdbService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(TmdbService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('getStatus should GET tmdb/status and return hasKey and apiKey', () => {
    const mockStatus: TmdbStatus = { hasKey: true, apiKey: 'abc123' };

    service.getStatus().subscribe(status => {
      expect(status.hasKey).toBeTrue();
      expect(status.apiKey).toBe('abc123');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/status`);
    expect(req.request.method).toBe('GET');
    req.flush(mockStatus);
  });

  it('testApiKey should POST the key to tmdb/test-key', () => {
    service.testApiKey('mykey').subscribe(res => {
      expect(res.message).toBe('API key is valid!');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/test-key`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ api_key: 'mykey' });
    req.flush({ message: 'API key is valid!' });
  });

  it('saveApiKey should POST the key to tmdb/save-key', () => {
    service.saveApiKey('mykey').subscribe(res => {
      expect(res.message).toBe('Saved!');
    });

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/save-key`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ key: 'mykey' });
    req.flush({ message: 'Saved!' });
  });
});
