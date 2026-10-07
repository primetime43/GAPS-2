import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScheduleHistoryComponent } from './schedule-history.component';
import { ScheduleLastRun } from '../../services/schedule.service';

function run(day: number, missing: number, extra: Partial<ScheduleLastRun> = {}): ScheduleLastRun {
  return { timestamp: `2026-01-${String(day).padStart(2, '0')}T12:00:00Z`, mediaType: 'movie',
    status: 'success', library: 'Movies', missing, collections: 1, message: '', ...extra };
}

describe('Scheduled scan history', () => {
  let fixture: ComponentFixture<ScheduleHistoryComponent>;
  let component: ScheduleHistoryComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ScheduleHistoryComponent] }).compileComponents();
    fixture = TestBed.createComponent(ScheduleHistoryComponent);
    component = fixture.componentInstance;
  });

  it('paginates the table newest first while the chart covers all retained scans', () => {
    fixture.componentRef.setInput('runs', Array.from({ length: 25 }, (_, i) => run(i + 1, i)));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(10);
    expect(component.pageRows[0].missing).toBe(24);
    expect(component.series[0].points.length).toBe(25);
    const buttons = fixture.nativeElement.querySelectorAll('nav button');
    buttons[1].click();
    fixture.detectChanges();
    expect(component.pageRows[0].missing).toBe(14);
    buttons[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(5);
    expect(fixture.nativeElement.textContent).toContain('Showing 21–25 of 25 runs');
    expect(buttons[1].disabled).toBeTrue();
    expect(component.series[0].points.length).toBe(25);
    fixture.componentRef.setInput('runs', [run(1, 0)]);
    fixture.detectChanges();
    expect(component.page).toBe(1);
  });

  it('charts zero counts but excludes failed, skipped and absent counts', () => {
    fixture.componentRef.setInput('runs', [run(1, 10), run(2, 0, { status: 'error' }),
      run(3, 0, { status: 'skipped' }), run(4, null as any), run(5, 0)]);
    fixture.detectChanges();
    expect(component.series[0].points.map(point => point.run.missing)).toEqual([10, 0]);
    expect(component.series[0].change).toBe('10 fewer missing');
    expect(component.filteredRuns.length).toBe(5);
    expect(component.yTicks[0].value).toBe(0);
    expect(component.series[0].path).not.toContain('NaN');
  });

  it('keeps media, library selections and servers separate and canonicalizes library order', () => {
    fixture.componentRef.setInput('runs', [
      run(1, 10, { libraries: ['Movies', '4K'], source: 'plex', server: 'A' }),
      run(2, 8, { libraries: ['4K', 'Movies'], source: 'plex', server: 'A' }),
      run(3, 9, { libraries: ['4K', 'Movies'], source: 'plex', server: 'B' }),
      run(4, 9, { libraries: ['Movies'], source: 'plex', server: 'A' }),
      run(5, 5, { mediaType: 'tv', library: 'TV', source: 'plex', server: 'A' }),
    ]);
    fixture.detectChanges();
    expect(component.series.length).toBe(4);
    const paired = component.series.find(series => series.points.length === 2)!;
    expect(paired.change).toBe('2 fewer missing');
    component.groupFilter = paired.key;
    component.refresh();
    expect(component.filteredRuns.length).toBe(2);
    expect(component.series.length).toBe(1);
  });

  it('uses elapsed time for spacing and describes increases, net zero and single observations', () => {
    fixture.componentRef.setInput('runs', [run(1, 4), run(2, 5), run(11, 8)]);
    fixture.detectChanges();
    const points = component.series[0].points;
    expect(points[1].x - points[0].x).toBeCloseTo((points[2].x - points[0].x) / 10);
    expect(component.series[0].change).toBe('4 more missing');
    fixture.componentRef.setInput('runs', [run(1, 0), run(2, 0)]);
    fixture.detectChanges();
    expect(component.series[0].change).toBe('No net change');
    expect(component.series[0].path).not.toContain('NaN');
    fixture.componentRef.setInput('runs', [run(1, 0)]);
    fixture.detectChanges();
    expect(component.series[0].change).toContain('more scans needed');
    expect(component.series[0].points[0].x).toBe(475);
  });

  it('exposes chart point values to keyboard users', () => {
    fixture.componentRef.setInput('runs', [run(1, 123)]);
    fixture.detectChanges();
    const point: SVGCircleElement = fixture.nativeElement.querySelector('circle');
    expect(point.getAttribute('tabindex')).toBe('0');
    expect(point.getAttribute('aria-label')).toContain('123 missing');
    point.dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.point-detail').textContent).toContain('123 missing');
  });

  it('shows empty states and only emits valid explicitly saved retention limits', () => {
    fixture.componentRef.setInput('retentionLimit', 50);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No scheduled scans recorded');
    const save = spyOn(component.retentionChange, 'emit');
    for (const invalid of [0, 9, 501, 10.5, null]) {
      component.draftLimit = invalid;
      component.saveLimit();
    }
    expect(save).not.toHaveBeenCalled();
    component.draftLimit = 25;
    expect(save).not.toHaveBeenCalled();
    component.saveLimit();
    expect(save).toHaveBeenCalledOnceWith(25);
    fixture.componentRef.setInput('runs', [run(1, 0, { status: 'error' })]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No successful scans');
  });
});
