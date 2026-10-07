import { of, Subject, throwError } from 'rxjs';
import { ScheduleSettingsComponent } from './schedule-settings.component';

describe('Schedule settings server selection', () => {
  it('uses the server whose libraries are shown, regardless of config response order', () => {
    const saved = new Subject<any>();
    const schedule = { getSchedule: () => saved };
    const active = { getActive: () => of({ source: 'jellyfin', server: 'New server', libraries: [] }) };
    const component = new ScheduleSettingsComponent(schedule as any, active as any);
    component.ngOnInit();
    saved.next({ source: 'plex', movie: {}, tv: {}, presets: {}, days: {} });
    expect(component.activeSource).toBe('jellyfin');
    expect(component.activeServerName).toBe('New server');
  });

  for (const operation of ['save', 'disable'] as const) {
    for (const type of ['movie', 'tv'] as const) {
      it(`preserves the other schedule's unsaved edits when ${operation} completes for ${type}`, () => {
        const config = { movie: {}, tv: {}, presets: {}, days: {} };
        const schedule = { setSchedule: () => of(config), disableSchedule: () => of(config) };
        const component = new ScheduleSettingsComponent(schedule as any, {} as any);
        component.moviePreset = 'weekly';
        component.selectedMovieLibraries = ['Movies'];
        component.movieTime = '19:30';
        component.movieDayOfWeek = 'fri';
        component.tvPreset = 'daily';
        component.selectedTvLibraries = ['TV'];
        component.tvTime = '21:45';
        component.tvDayOfWeek = 'sat';
        component[operation](type);
        if (type === 'movie') {
          expect(component.tvPreset).toBe('daily');
          expect(component.selectedTvLibraries).toEqual(['TV']);
          expect(component.tvTime).toBe('21:45');
          expect(component.tvDayOfWeek).toBe('sat');
        } else {
          expect(component.moviePreset).toBe('weekly');
          expect(component.selectedMovieLibraries).toEqual(['Movies']);
          expect(component.movieTime).toBe('19:30');
          expect(component.movieDayOfWeek).toBe('fri');
        }
      });
    }
  }
  it('saving history retention preserves both unsaved schedule forms', () => {
    const service = { setHistoryLimit: jasmine.createSpy().and.returnValue(of({ historyLimit: 25, run_history: [] })) };
    const component = new ScheduleSettingsComponent(service as any, {} as any);
    component.schedule = { historyLimit: 50, movie: {}, tv: {} } as any;
    component.moviePreset = 'weekly';
    component.selectedMovieLibraries = ['Unsaved movies'];
    component.tvTime = '23:30';
    component.selectedTvLibraries = ['Unsaved TV'];
    component.saveHistoryLimit(25);
    expect(service.setHistoryLimit).toHaveBeenCalledWith(25);
    expect(component.schedule.historyLimit).toBe(25);
    expect(component.moviePreset).toBe('weekly');
    expect(component.selectedMovieLibraries).toEqual(['Unsaved movies']);
    expect(component.tvTime).toBe('23:30');
    expect(component.selectedTvLibraries).toEqual(['Unsaved TV']);
    expect(component.savingHistory).toBeFalse();
  });

  it('keeps existing history visible and shows a retryable error when retention saving fails', () => {
    const service = { setHistoryLimit: () => throwError(() => ({ error: { error: 'Storage unavailable' } })) };
    const component = new ScheduleSettingsComponent(service as any, {} as any);
    const before = { historyLimit: 50, run_history: [{ missing: 5 }] } as any;
    component.schedule = before;
    component.saveHistoryLimit(10);
    expect(component.schedule).toBe(before);
    expect(component.historyError).toBe('Storage unavailable');
    expect(component.savingHistory).toBeFalse();
  });

});
