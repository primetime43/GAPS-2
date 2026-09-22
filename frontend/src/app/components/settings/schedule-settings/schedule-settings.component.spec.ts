import { of, Subject } from 'rxjs';
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
});
