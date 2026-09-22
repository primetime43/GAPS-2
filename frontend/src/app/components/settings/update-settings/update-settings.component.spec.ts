import { fakeAsync, tick } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { UpdateService, UpdateStatus } from '../../../services/update.service';
import { UpdateSettingsComponent } from './update-settings.component';

describe('UpdateSettingsComponent', () => {
  let component: UpdateSettingsComponent;
  let service: jasmine.SpyObj<UpdateService>;
  let status: UpdateStatus;

  beforeEach(() => {
    localStorage.removeItem('gaps-update-request');
    status = { build: { version: '2.11.0', commit: 'abc123', installType: 'docker', channel: 'stable' },
      updater: { available: true, reason: '', state: 'idle' } };
    service = jasmine.createSpyObj('UpdateService', ['getStatus', 'getReleases', 'apply']);
    service.getStatus.and.callFake(() => of(status));
    service.getReleases.and.returnValue(of({ versions: ['2.11.0'] }));
    service.apply.and.returnValue(of({ requestId: 'job1', message: 'Queued' }));
    component = new UpdateSettingsComponent(service);
    spyOn(component, 'reloadPage');
  });

  afterEach(() => {
    component.ngOnDestroy();
    localStorage.removeItem('gaps-update-request');
  });

  it('keeps edits while polling and disables apply without the updater', fakeAsync(() => {
    component.ngOnInit();
    tick();
    component.choice = { channel: 'version', version: '2.10.0' };
    status.updater.available = false;
    tick(3000);
    expect(component.choice.version).toBe('2.10.0');
    expect(component.canApply).toBeFalse();
    component.apply();
    expect(service.apply).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('requires a full version before applying a pinned release', fakeAsync(() => {
    component.ngOnInit();
    tick();
    component.choice = { channel: 'version', version: '../latest' };
    expect(component.canApply).toBeFalse();
    component.choice.version = 'v2.11.0';
    expect(component.canApply).toBeTrue();
    component.ngOnDestroy();
  }));

  it('submits once, reconnects through downtime, and reloads when finished', fakeAsync(() => {
    component.ngOnInit();
    tick();
    component.choice.channel = 'develop';
    component.apply();
    component.apply();
    expect(service.apply).toHaveBeenCalledTimes(1);
    service.getStatus.and.returnValue(throwError(() => new Error('restarting')));
    tick(3000);
    expect(component.reconnecting).toBeTrue();
    expect(component.busy).toBeTrue();
    status.updater = { available: true, reason: '', state: 'done', requestId: 'job1' };
    service.getStatus.and.returnValue(of(status));
    tick(3000);
    expect(component.reloadPage).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('gaps-update-request')).toBeNull();
    component.ngOnDestroy();
  }));

  it('shows rollback failure status without repeatedly reloading', fakeAsync(() => {
    localStorage.setItem('gaps-update-request', 'job1');
    status.updater = { available: true, reason: '', state: 'error', requestId: 'job1', message: 'Previous build restored.' };
    component.ngOnInit();
    tick();
    expect(component.busy).toBeFalse();
    expect(component.status?.updater.message).toContain('restored');
    expect(component.reloadPage).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('allows retrying a rejected request and cancels pending requests on destroy', fakeAsync(() => {
    component.ngOnInit();
    tick();
    service.apply.and.returnValue(throwError(() => ({ error: { error: 'Updater unavailable' } })));
    component.apply();
    expect(component.error).toBe('Updater unavailable');
    expect(component.canApply).toBeTrue();
    const pending = new Subject<any>();
    service.apply.and.returnValue(pending);
    component.apply();
    component.ngOnDestroy();
    pending.next({ requestId: 'late' });
    expect(component.requestId).toBe('');
  }));
});
