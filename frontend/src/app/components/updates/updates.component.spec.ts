import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { UpdatesComponent } from './updates.component';

describe('UpdatesComponent', () => {
  let component: UpdatesComponent;
  let fixture: ComponentFixture<UpdatesComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      declarations: [UpdatesComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UpdatesComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should start in loading state', () => {
    expect(component.loading).toBeTrue();
    expect(component.releases).toEqual([]);
  });

  it('should load releases on init', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases');
    req.flush([{
      tag_name: 'v2.0.0',
      name: 'Release 2.0.0',
      body: 'Initial release',
      published_at: '2025-01-01T00:00:00Z',
      html_url: 'https://example.com',
    }]);
    tick();

    expect(component.loading).toBeFalse();
    expect(component.releases.length).toBe(1);
  }));

  it('should handle error when loading releases', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne('https://api.github.com/repos/primetime43/GAPS-2/releases');
    req.error(new ProgressEvent('Network error'));
    tick();

    expect(component.loading).toBeFalse();
    expect(component.error).toBe('Could not load releases from GitHub.');
  }));
});
