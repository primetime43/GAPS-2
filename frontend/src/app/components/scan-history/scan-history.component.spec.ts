import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ScanHistoryComponent } from './scan-history.component';
import { ScanHistoryEntry } from '../../services/scan-history.service';
import { environment } from '../../../environments/environment';

describe('ScanHistoryComponent', () => {
  let component: ScanHistoryComponent;
  let fixture: ComponentFixture<ScanHistoryComponent>;
  let httpMock: HttpTestingController;
  let queryParamMap$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  const exportableEntry: ScanHistoryEntry = {
    id: 'abc123',
    timestamp: '2026-05-20T10:00:00Z',
    mediaType: 'movie',
    libraries: ['Movies'],
    totalOwned: 50,
    missing: 5,
    status: 'success',
    trigger: 'manual',
    message: '',
    hasGaps: true,
  };

  const legacyEntry: ScanHistoryEntry = {
    // No id / hasGaps — pre-feature scan.
    timestamp: '2026-05-19T10:00:00Z',
    mediaType: 'movie',
    libraries: ['Movies'],
    totalOwned: 50,
    missing: 5,
    status: 'success',
    trigger: 'manual',
    message: '',
  };

  beforeEach(async () => {
    queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, RouterTestingModule],
      declarations: [ScanHistoryComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParamMap$.asObservable() } },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanHistoryComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads history with no type filter by default', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    const req = httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=50`);
    expect(req.request.method).toBe('GET');
    req.flush({ history: [exportableEntry], lastMovie: null, lastTv: null });

    expect(component.entries.length).toBe(1);
    expect(component.loading).toBeFalse();
    expect(component.mediaTypeFilter).toBe('all');
  }));

  it('applies the type filter from the query param', fakeAsync(() => {
    queryParamMap$.next(convertToParamMap({ type: 'tv' }));
    fixture.detectChanges();
    tick();

    const req = httpMock.expectOne(`${environment.apiUrl}/scan-history?mediaType=tv&limit=50`);
    req.flush({ history: [], lastMovie: null, lastTv: null });

    expect(component.mediaTypeFilter).toBe('tv');
  }));

  it('shows an error message on failure', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    const req = httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=50`);
    req.flush({ error: 'kaboom' }, { status: 500, statusText: 'Server Error' });

    expect(component.error).toBe('kaboom');
    expect(component.loading).toBeFalse();
  }));

  it('canExport is true only for entries with id, hasGaps, and status=success', () => {
    expect(component.canExport(exportableEntry)).toBeTrue();
    expect(component.canExport(legacyEntry)).toBeFalse();
    expect(component.canExport({ ...exportableEntry, status: 'error' })).toBeFalse();
    expect(component.canExport({ ...exportableEntry, hasGaps: false })).toBeFalse();
  });

  it('export tooltip explains why legacy rows cannot export', () => {
    const msg = component.exportTooltip(legacyEntry, 'csv');
    expect(msg).toContain('re-run the scan');
  });

  it('fetches per-row gaps and writes a workbook on export', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=50`)
      .flush({ history: [exportableEntry], lastMovie: null, lastTv: null });

    const writeSpy = spyOn<any>(component, 'writeWorkbook').and.returnValue(Promise.resolve());

    component.exportRow(exportableEntry, 'xlsx');
    tick();

    httpMock.expectOne(`${environment.apiUrl}/scan-history/${exportableEntry.id}`).flush({
      ...exportableEntry,
      gaps: [{ tmdbId: 1, name: 'Movie A', year: '2020', collectionName: 'Coll', owned: false }],
    });
    tick();

    expect(writeSpy).toHaveBeenCalled();
    expect(component.exportingFor[exportableEntry.id!]).toBeNull();
  }));

  it('records a row-level error when fetching gaps fails', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=50`)
      .flush({ history: [exportableEntry], lastMovie: null, lastTv: null });

    component.exportRow(exportableEntry, 'csv');
    tick();

    httpMock.expectOne(`${environment.apiUrl}/scan-history/${exportableEntry.id}`)
      .flush({ error: 'nope' }, { status: 404, statusText: 'Not Found' });
    tick();

    expect(component.rowError[exportableEntry.id!]).toBe('nope');
    expect(component.exportingFor[exportableEntry.id!]).toBeNull();
  }));

  it('does not fetch when the entry is not exportable', fakeAsync(() => {
    fixture.detectChanges();
    tick();

    httpMock.expectOne(`${environment.apiUrl}/scan-history?limit=50`)
      .flush({ history: [legacyEntry], lastMovie: null, lastTv: null });

    component.exportRow(legacyEntry, 'csv');
    tick();

    // No HTTP call should be made.
    httpMock.verify();
  }));
});
