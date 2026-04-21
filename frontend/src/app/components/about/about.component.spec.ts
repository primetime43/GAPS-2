import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AboutComponent } from './about.component';
import { environment } from '../../../environments/environment';

describe('AboutComponent', () => {
  let component: AboutComponent;
  let fixture: ComponentFixture<AboutComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
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
});
