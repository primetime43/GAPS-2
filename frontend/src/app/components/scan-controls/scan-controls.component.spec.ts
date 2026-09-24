import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ScanControlsComponent } from './scan-controls.component';
import { environment } from '../../../environments/environment';

describe('ScanControlsComponent', () => {
  let fixture: ComponentFixture<ScanControlsComponent>;
  let component: ScanControlsComponent;
  let http: HttpTestingController;
  const api = environment.apiUrl;
  const idle = { status: 'idle', processed: 0, total: 0, libraries: [], error: null, completed_at: null };
  const running = { ...idle, status: 'scanning', processed: 5, total: 20, libraries: ['Films'] };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScanControlsComponent, HttpClientTestingModule, RouterTestingModule] }).compileComponents();
    fixture = TestBed.createComponent(ScanControlsComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  function run(body: () => void) {
    return fakeAsync(() => { try { body(); } finally { fixture.destroy(); } });
  }
  function progress(source: string, value: any = idle) {
    http.expectOne(`${api}/${source}/scan/progress?summary=true`).flush(value);
  }
  function init(movie: any = idle, tv: any = idle) {
    fixture.detectChanges();
    progress('recommendations', movie);
    progress('tvdb', tv);
    fixture.detectChanges();
  }
  function libraries(type: number, source = 'plex', libs = [{ title: 'Films', type: 'movie' }], defaultLibrary = '') {
    component.chooseLibraries(component.scans[type]);
    for (const name of ['plex', 'jellyfin', 'emby']) {
      http.expectOne(`${api}/${name}/active-server`).flush(name === source ? { server: 'Test server', libraries: libs } : {});
    }
    http.expectOne(`${api}/preferences`).flush({ defaultLibrary });
  }

  it('renders three actions and does not scan until libraries are chosen', run(() => {
    init();
    const actions = fixture.nativeElement.querySelector('.scan-actions');
    expect(actions.textContent).toContain('Scan Movies');
    expect(actions.textContent).toContain('Scan TV Shows');
    expect(actions.textContent).toContain('View Missing');
    http.expectNone(request => request.method === 'POST');
  }));

  it('starts a movie scan with the selected libraries and source using saved preferences', run(() => {
    init();
    libraries(0, 'jellyfin', [{ title: 'Films', type: 'movies' }, { title: 'Kids', type: 'movie' }, { title: 'TV', type: 'tvshows' }], 'Films');
    expect(component.libraries).toEqual(['Films', 'Kids']);
    expect(component.selected).toEqual(['Films']);
    component.toggleLibrary('Kids');
    component.startScan();
    component.startScan();
    const start = http.expectOne(`${api}/recommendations/scan`);
    expect(start.request.body).toEqual({ libraryNames: ['Films', 'Kids'], source: 'jellyfin', showExisting: true, freshScan: false, incremental: false });
    start.flush({ status: 'started', total: 20, mode: 'full' });
    progress('recommendations', running);
    fixture.detectChanges();
    expect(component.picker).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('25');
    expect(component.canChoose(component.scans[0])).toBeFalse();
  }));

  it('starts TV scans through TheTVDB and shows the current phase', run(() => {
    init();
    libraries(1, 'emby', [{ title: 'Shows', type: 'tvshows' }, { title: 'Movies', type: 'movies' }]);
    component.startScan();
    const start = http.expectOne(`${api}/tvdb/scan`);
    expect(start.request.body).toEqual({ libraryNames: ['Shows'], source: 'emby', showExisting: true, freshScan: false });
    start.flush({ status: 'started' });
    progress('tvdb', { ...running, phase: 'franchises', libraries: ['Shows'] });
    expect(component.phase(component.scans[1])).toBe('Loading franchises');
    http.expectNone(`${api}/recommendations/scan`);
  }));

  it('requires an explicit selection when several libraries have no matching default', run(() => {
    init();
    libraries(0, 'plex', [{ title: 'Films', type: 'movie' }, { title: 'Kids', type: 'movie' }], 'TV');
    component.startScan();
    expect(component.selected).toEqual([]);
    http.expectNone(`${api}/recommendations/scan`);
  }));

  it('explains missing libraries and does not start a scan', run(() => {
    init();
    libraries(1);
    expect(component.libraryError).toContain('No tv shows libraries');
    component.startScan();
    http.expectNone(`${api}/tvdb/scan`);
  }));

  it('monitors both existing scans and confirms cancellation from progress', run(() => {
    init(running, { ...running, phase: 'titles', libraries: ['Shows'] });
    const finished = spyOn(component.scanFinished, 'emit');
    component.cancelScan(component.scans[1]);
    component.cancelScan(component.scans[1]);
    http.expectOne(`${api}/tvdb/scan/cancel`).flush({ cancelled: true });
    expect(component.scans[1].cancelling).toBeTrue();
    progress('tvdb', { ...idle, status: 'cancelled' });
    expect(component.scans[1].cancelling).toBeFalse();
    expect(component.phase(component.scans[1])).toBe('Scan cancelled');
    expect(component.busy(component.scans[0])).toBeTrue();
    expect(finished).toHaveBeenCalledTimes(1);
  }));

  it('retains a running scan when cancellation fails and allows another attempt', run(() => {
    init(running);
    component.cancelScan(component.scans[0]);
    http.expectOne(`${api}/recommendations/scan/cancel`).flush({}, { status: 503, statusText: 'Offline' });
    expect(component.scans[0].error).toContain('Could not cancel');
    expect(component.busy(component.scans[0])).toBeTrue();
    expect(component.scans[0].cancelling).toBeFalse();
    component.cancelScan(component.scans[0]);
    http.expectOne(`${api}/recommendations/scan/cancel`).flush({ cancelled: false });
    progress('recommendations', { ...idle, status: 'done' });
    expect(component.phase(component.scans[0])).toBe('Scan complete');
  }));

  it('recovers from progress errors without allowing a duplicate scan', run(() => {
    init(running);
    tick(2500);
    http.expectOne(`${api}/recommendations/scan/progress?summary=true`).flush({}, { status: 503, statusText: 'Offline' });
    progress('tvdb');
    expect(component.scans[0].pollError).toContain('may still be running');
    expect(component.canChoose(component.scans[0])).toBeFalse();
    tick(2500);
    progress('recommendations', running);
    progress('tvdb');
    expect(component.scans[0].pollError).toBe('');
  }));

  it('reports scan-start errors and detects an already running scan after a conflict', run(() => {
    init();
    libraries(0);
    component.startScan();
    http.expectOne(`${api}/recommendations/scan`).flush({ error: 'A scan is already in progress' }, { status: 409, statusText: 'Conflict' });
    progress('recommendations', running);
    expect(component.scans[0].error).toContain('already in progress');
    expect(component.busy(component.scans[0])).toBeTrue();
  }));

  it('ignores an old idle response that arrives after a new scan starts', run(() => {
    init();
    libraries(0);
    tick(2500);
    const old = http.expectOne(`${api}/recommendations/scan/progress?summary=true`);
    progress('tvdb');
    component.startScan();
    http.expectOne(`${api}/recommendations/scan`).flush({ status: 'started' });
    old.flush(idle);
    expect(component.busy(component.scans[0])).toBeTrue();
    tick(2500);
    progress('recommendations', running);
    progress('tvdb');
  }));

  it('shows TV completion with a typed results link and refreshes history once', run(() => {
    init(idle, { ...running, phase: 'shows' });
    const finished = spyOn(component.scanFinished, 'emit');
    tick(2500);
    progress('recommendations');
    progress('tvdb', { ...idle, status: 'done' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.results-link').getAttribute('href')).toContain('type=tv');
    expect(finished).toHaveBeenCalledTimes(1);
    tick(2500);
    progress('recommendations');
    progress('tvdb', { ...idle, status: 'done' });
    expect(finished).toHaveBeenCalledTimes(1);
  }));

  it('stops polling when the dashboard is destroyed without cancelling scans', run(() => {
    init(running);
    tick(2500);
    const pending = http.match(request => request.url.endsWith('/scan/progress'));
    fixture.destroy();
    expect(pending.every(request => request.cancelled)).toBeTrue();
    tick(5000);
    http.expectNone(() => true);
  }));
});
