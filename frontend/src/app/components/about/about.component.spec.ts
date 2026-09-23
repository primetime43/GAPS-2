import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AboutComponent } from './about.component';
import { environment } from '../../../environments/environment';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    // Load the real lazy chunk before fakeAsync starts controlling timers.
    await import('marked');
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      declarations: [AboutComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AboutComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should set version from environment', () => {
    expect(component.version).toEqual(environment.version);
  });

  it('should start in loading state', () => {
    expect(component.releasesLoading).toBeTrue();
    expect(component.releases).toEqual([]);
  });

  it('should load and parse releases from GitHub API on init', fakeAsync(() => {
    fixture.detectChanges();

    httpMock.expectOne('/api/about').flush({ version: '2.3.0', commit: 'dev' });

    const req = httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases');
    expect(req.request.method).toBe('GET');

    req.flush([
      {
        tag_name: 'v2.1.0',
        name: 'Release 2.1.0',
        body: '**New features**',
        published_at: '2025-01-01T00:00:00Z',
        html_url: 'https://github.com/primetime43/GAPS-2/releases/tag/v2.1.0',
      }
    ]);
    tick();

    expect(component.releasesLoading).toBeFalse();
    expect(component.releases.length).toBe(1);
    expect(component.releases[0].tag_name).toBe('v2.1.0');
    expect(component.releases[0].bodyHtml).toBeTruthy();
  }));

  it('should handle GitHub API error gracefully', fakeAsync(() => {
    fixture.detectChanges();

    httpMock.expectOne('/api/about').flush({ version: '2.3.0', commit: 'dev' });

    const req = httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases');
    req.error(new ProgressEvent('Network error'));
    tick();

    expect(component.releasesLoading).toBeFalse();
    expect(component.releasesError).toBe('Could not load releases from GitHub.');
    expect(component.releases).toEqual([]);
  }));

  it('should expose a short commit and commit URL', fakeAsync(() => {
    fixture.detectChanges();

    httpMock.expectOne('/api/about').flush({ version: '2.3.0', commit: 'a1b2c3d4e5f6' });
    httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases').flush([]);
    tick();

    expect(component.shortCommit).toBe('a1b2c3d');
    expect(component.commitUrl).toBe('https://github.com/primetime43/GAPS-2/commit/a1b2c3d4e5f6');
  }));

  it('shows the install type, registry, and builder alongside release history', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/about').flush({ version: '2.11.0', commit: 'abc123', installType: 'docker',
      channel: 'develop', registry: 'GitHub Container Registry', buildSource: 'github-actions' });
    httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases').flush([]);
    tick();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Docker');
    expect(text).toContain('GitHub Container Registry');
    expect(text).toContain('Built by GitHub Actions');
    expect(text).toContain('Release History');
  }));

  it('paginates release history and expands only the newest release by default', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/about').flush({ version: '2.11.0', commit: 'dev' });
    httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases').flush(
      Array.from({ length: 12 }, (_, i) => ({
        tag_name: `v2.${12 - i}.0`, name: '', body: `Notes for release ${i + 1}`,
        published_at: '2026-01-01T00:00:00Z', html_url: `https://example.com/releases/${i + 1}`,
      }))
    );
    tick();
    fixture.detectChanges();

    const entries = () => fixture.nativeElement.querySelectorAll('details.changelog-entry');
    const buttons = fixture.nativeElement.querySelectorAll('.release-pagination button');
    expect(entries().length).toBe(5);
    expect(entries()[0].open).toBeTrue();
    expect(entries()[1].open).toBeFalse();
    expect(buttons[0].disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Page 1 of 3');

    buttons[1].click();
    fixture.detectChanges();
    expect(entries().length).toBe(5);
    expect(entries()[0].textContent).toContain('v2.7.0');
    expect(entries()[0].open).toBeFalse();
    expect(fixture.nativeElement.textContent).toContain('Page 2 of 3');

    buttons[1].click();
    fixture.detectChanges();
    expect(entries().length).toBe(2);
    expect(entries()[1].querySelector('.release-body').textContent).toContain('Notes for release 12');
    expect(buttons[1].disabled).toBeTrue();
    expect(component.releases.length).toBe(12);

    buttons[0].click();
    fixture.detectChanges();
    expect(component.releasePage).toBe(2);
    expect(entries()[0].textContent).toContain('v2.7.0');
    component.setReleasePage(0);
    component.setReleasePage(4);
    expect(component.releasePage).toBe(2);
  }));

  it('hides page controls for a single release and retains the full archive link', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne('/api/about').flush({ version: '2.11.0', commit: 'dev' });
    httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases').flush([
      { tag_name: 'v2.11.0', name: 'Latest', body: '', published_at: '2026-01-01', html_url: 'https://example.com' },
    ]);
    tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.release-pagination')).toBeNull();
    expect(fixture.nativeElement.querySelector('details').open).toBeTrue();
    expect(fixture.nativeElement.querySelector('a[href="https://github.com/primetime43/GAPS-2/releases"]')).not.toBeNull();
  }));
});
