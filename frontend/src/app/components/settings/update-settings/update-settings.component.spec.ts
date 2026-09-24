import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { UpdateService, UpdateStatus } from '../../../services/update.service';
import { UpdateSettingsComponent } from './update-settings.component';
import { ConfirmModalComponent } from '../../confirm-modal/confirm-modal.component';

describe('UpdateSettingsComponent', () => {
  let component: UpdateSettingsComponent;
  let service: jasmine.SpyObj<UpdateService>;
  let status: UpdateStatus;

  beforeEach(() => {
    localStorage.removeItem('gaps-update-request');
    status = { build: { version: '2.11.0', commit: 'abc123', installType: 'docker', channel: 'stable' },
      updater: { available: true, reason: '', state: 'idle' } };
    service = jasmine.createSpyObj('UpdateService', ['getStatus', 'getReleases', 'getDevelop', 'apply']);
    service.getDevelop.and.returnValue(of({ commit: '6'.repeat(40), checkedAt: 1000 }));
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

  it('does not apply using stale status while reconnecting', fakeAsync(() => {
    component.ngOnInit();
    tick();
    service.getStatus.and.returnValue(throwError(() => new Error('offline')));
    tick(3000);
    expect(component.canApply).toBeFalse();
    component.apply();
    expect(service.apply).not.toHaveBeenCalled();
    component.ngOnDestroy();
  }));

  it('detects a different Develop commit despite a previous successful update', fakeAsync(() => {
    status.build.channel = 'develop';
    status.build.commit = '4'.repeat(40);
    status.updater = { ...status.updater, state: 'done', message: 'Last update completed.' };
    component.ngOnInit();
    tick();
    expect(component.matchesDevelop).toBeFalse();
    expect(component.develop?.commit).toBe('6'.repeat(40));
    status.build.commit = '6'.repeat(40);
    tick(3000);
    expect(component.matchesDevelop).toBeTrue();
    component.ngOnDestroy();
  }));

  it('clears a previous match when the GitHub check fails', fakeAsync(() => {
    status.build.channel = 'develop';
    status.build.commit = '6'.repeat(40);
    component.ngOnInit();
    tick();
    expect(component.matchesDevelop).toBeTrue();
    service.getDevelop.and.returnValue(throwError(() => new Error('rate limit')));
    component.checkDevelop();
    expect(component.matchesDevelop).toBeFalse();
    expect(component.develop).toBeNull();
    expect(component.developError).toContain('unknown');
    component.ngOnDestroy();
  }));

  it('refreshes GitHub separately from frequent updater heartbeat polling', fakeAsync(() => {
    status.build.channel = 'develop';
    component.ngOnInit();
    tick();
    expect(service.getDevelop).toHaveBeenCalledTimes(1);
    tick(120000);
    expect(service.getDevelop).toHaveBeenCalledTimes(2);
    component.ngOnDestroy();
  }));
});

describe('Updates tab', () => {
  let fixture: ComponentFixture<UpdateSettingsComponent>;
  let service: jasmine.SpyObj<UpdateService>;

  beforeEach(async () => {
    localStorage.removeItem('gaps-update-request');
    service = jasmine.createSpyObj('UpdateService', ['getStatus', 'getReleases', 'getDevelop', 'apply']);
    service.getDevelop.and.returnValue(of({ commit: '6'.repeat(40), checkedAt: 1000 }));
    service.getStatus.and.returnValue(of({
      build: { version: '2.11.0', commit: 'abc123', installType: 'docker', channel: 'develop' },
      updater: { available: true, reason: '', state: 'idle', message: 'Ready.' },
    }));
    service.getReleases.and.returnValue(of({ versions: [] }));
    service.apply.and.returnValue(of({ requestId: 'develop-job', message: 'Queued' }));
    await TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [UpdateSettingsComponent, ConfirmModalComponent],
      providers: [{ provide: UpdateService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(UpdateSettingsComponent);
  });

  afterEach(() => {
    fixture.destroy();
    localStorage.removeItem('gaps-update-request');
  });

  it('offers a fresh Develop pull for an existing Develop install after confirmation', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button.btn-primary') as HTMLButtonElement;
    expect(button.textContent).toContain('Get latest Develop');
    expect(button.disabled).toBeFalse();
    button.click();
    fixture.detectChanges();
    expect(service.apply).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.modal-message').textContent).toContain('Pull the latest Develop image');
    fixture.nativeElement.querySelector('.btn-confirm').click();
    fixture.detectChanges();
    expect(service.apply).toHaveBeenCalledOnceWith({ channel: 'develop', version: '' });
    expect(button.disabled).toBeTrue();
    fixture.destroy();
  }));

  it('uses a compact Ready status and allows cancelling without updating', fakeAsync(() => {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector('[role="status"]');
    expect(status.textContent.trim()).toBe('Ready.');
    expect(status.classList.contains('alert')).toBeFalse();
    expect(status.classList.contains('update-status')).toBeTrue();
    fixture.nativeElement.querySelector('button.btn-primary').click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.btn-cancel').click();
    fixture.detectChanges();
    expect(service.apply).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.modal-backdrop')).toBeNull();
    fixture.destroy();
  }));

  it('shows source mismatch and publication guidance beside the last update result', fakeAsync(() => {
    service.getStatus.and.returnValue(of({
      build: { version: '2.12.0', commit: '4'.repeat(40), channel: 'develop' },
      updater: { available: true, reason: '', state: 'done', message: 'Last update completed.', completedAt: 500 },
    }));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Last update completed.');
    expect(text).toContain('Last completed check:');
    expect(text).toContain('does not match');
    expect(text).toContain('6666666');
    expect(text).toContain('still building');
    fixture.destroy();
  }));
});
