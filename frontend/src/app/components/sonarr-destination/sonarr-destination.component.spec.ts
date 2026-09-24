import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SonarrDestinationComponent } from './sonarr-destination.component';
import { SonarrService } from '../../services/sonarr.service';
import { environment } from '../../../environments/environment';

describe('Sonarr destination', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SonarrDestinationComponent, HttpClientTestingModule],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('offers Sonarr folders and emits an explicit destination or automatic routing', async () => {
    const fixture = TestBed.createComponent(SonarrDestinationComponent);
    const selected = jasmine.createSpy('selected');
    fixture.componentInstance.rootFolderPathChange.subscribe(selected);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/sonarr/config`).flush({ enabled: true });
    http.expectOne(`${environment.apiUrl}/sonarr/root-folders`).flush([
      { path: '/tv', accessible: true }, { path: '/offline', accessible: false },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('select');
    expect(select.options[2].disabled).toBeTrue();
    select.value = '/tv';
    select.dispatchEvent(new Event('change'));
    expect(selected).toHaveBeenCalledWith('/tv');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    expect(selected).toHaveBeenCalledWith('');
  });

  it('allows retrying unavailable folders without discarding the chosen destination', () => {
    const fixture = TestBed.createComponent(SonarrDestinationComponent);
    fixture.componentInstance.rootFolderPath = '/tv';
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/sonarr/config`).flush({ enabled: true });
    http.expectOne(`${environment.apiUrl}/sonarr/root-folders`).flush({}, { status: 502, statusText: 'Offline' });
    fixture.detectChanges();
    expect(fixture.componentInstance.rootFolderPath).toBe('/tv');
    fixture.nativeElement.querySelector('button').click();
    http.expectOne(`${environment.apiUrl}/sonarr/root-folders`).flush([{ path: '/tv', accessible: true }]);
    expect(fixture.componentInstance.error).toBe('');
  });

  it('sends server, libraries, and explicit destination in series-add requests', () => {
    const context = { source: 'plex', server: 'Plex', library_names: ['TV Shows'], root_folder_path: '/tv' };
    TestBed.inject(SonarrService).addSeries(123, 'Test', context).subscribe();
    const request = http.expectOne(`${environment.apiUrl}/sonarr/add`);
    expect(request.request.body).toEqual({ tvdb_id: 123, title: 'Test', ...context });
    request.flush({ message: 'Added' });
  });
});
