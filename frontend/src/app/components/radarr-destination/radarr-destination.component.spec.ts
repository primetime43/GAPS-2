import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RadarrDestinationComponent } from './radarr-destination.component';
import { RadarrService } from '../../services/radarr.service';
import { environment } from '../../../environments/environment';

describe('Radarr destination', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RadarrDestinationComponent, HttpClientTestingModule],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('offers Radarr folders and emits an explicit destination or automatic routing', async () => {
    const fixture = TestBed.createComponent(RadarrDestinationComponent);
    const selected = jasmine.createSpy('selected');
    fixture.componentInstance.rootFolderPathChange.subscribe(selected);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/radarr/config`).flush({ enabled: true });
    http.expectOne(`${environment.apiUrl}/radarr/root-folders`).flush([
      { path: '/movies', accessible: true }, { path: '/offline', accessible: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    expect(select.options[2].disabled).toBeTrue();
    select.value = '/movies';
    select.dispatchEvent(new Event('change'));
    expect(selected).toHaveBeenCalledWith('/movies');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(selected).toHaveBeenCalledWith('');
  });

  it('allows retrying unavailable folders without discarding the chosen destination', () => {
    const fixture = TestBed.createComponent(RadarrDestinationComponent);
    fixture.componentInstance.rootFolderPath = '/movies';
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/radarr/config`).flush({ enabled: true });
    http.expectOne(`${environment.apiUrl}/radarr/root-folders`).flush({}, { status: 502, statusText: 'Offline' });
    fixture.detectChanges();
    expect(fixture.componentInstance.rootFolderPath).toBe('/movies');
    fixture.nativeElement.querySelector('button').click();
    http.expectOne(`${environment.apiUrl}/radarr/root-folders`).flush([{ path: '/movies', accessible: true }]);
    expect(fixture.componentInstance.error).toBe('');
  });

  it('sends server, libraries, and explicit destination in movie-add requests', () => {
    const context = { source: 'plex', server: 'Plex', library_names: ['Movies'], root_folder_path: '/movies' };
    TestBed.inject(RadarrService).addMovie(123, 'Test', 2020, context).subscribe();
    const request = http.expectOne(`${environment.apiUrl}/radarr/add`);
    expect(request.request.body).toEqual({ tmdb_id: 123, title: 'Test', year: 2020, ...context });
    request.flush({ message: 'Added' });
  });
});
