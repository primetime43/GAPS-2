import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { TmdbSettingsComponent } from './tmdb-settings.component';
import { environment } from '../../../../environments/environment';

describe('TmdbSettingsComponent', () => {
  let component: TmdbSettingsComponent;
  let fixture: ComponentFixture<TmdbSettingsComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, ReactiveFormsModule],
      declarations: [TmdbSettingsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TmdbSettingsComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load TMDB status on init and populate the form if a key exists', fakeAsync(() => {
    fixture.detectChanges();

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/status`);
    req.flush({ hasKey: true, apiKey: 'existing-key' });
    tick();

    expect(component.hasKey).toBeTrue();
    expect(component.tmdbForm.get('movieDbApiKey')?.value).toBe('existing-key');
  }));

  it('should show error when testing with empty key', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`).flush({ hasKey: false, apiKey: '' });
    tick();

    component.testTmdbKey();

    expect(component.message).toBe('Please enter an API key first.');
    expect(component.messageType).toBe('error');
  }));

  it('should call test-key API and show success on valid key', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`).flush({ hasKey: false, apiKey: '' });
    tick();

    component.tmdbForm.patchValue({ movieDbApiKey: 'valid-key' });
    component.testTmdbKey();
    expect(component.testing).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/test-key`);
    expect(req.request.body).toEqual({ api_key: 'valid-key' });
    req.flush({ message: 'API key is working!' });
    tick();

    expect(component.testing).toBeFalse();
    expect(component.message).toBe('API key is working!');
    expect(component.messageType).toBe('success');
  }));

  it('should call save-key API and update hasKey on success', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`).flush({ hasKey: false, apiKey: '' });
    tick();

    component.tmdbForm.patchValue({ movieDbApiKey: 'new-key' });
    component.saveTmdbKey();
    expect(component.saving).toBeTrue();

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/save-key`);
    expect(req.request.body).toEqual({ key: 'new-key' });
    req.flush({ message: 'Saved!' });
    tick();

    expect(component.saving).toBeFalse();
    expect(component.hasKey).toBeTrue();
    expect(component.messageType).toBe('success');
  }));

  it('should handle save-key API error', fakeAsync(() => {
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/tmdb/status`).flush({ hasKey: false, apiKey: '' });
    tick();

    component.tmdbForm.patchValue({ movieDbApiKey: 'bad-key' });
    component.saveTmdbKey();

    const req = httpMock.expectOne(`${environment.apiUrl}/tmdb/save-key`);
    req.flush({ error: 'Invalid key' }, { status: 400, statusText: 'Bad Request' });
    tick();

    expect(component.saving).toBeFalse();
    expect(component.messageType).toBe('error');
  }));
});
