import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { RadarrService, RadarrTag } from '../../../services/radarr.service';
import { RadarrSettingsComponent } from './radarr-settings.component';

describe('Radarr default tags', () => {
  let fixture: ComponentFixture<RadarrSettingsComponent>;
  let component: RadarrSettingsComponent;
  let service: jasmine.SpyObj<RadarrService>;

  beforeEach(async () => {
    service = jasmine.createSpyObj('RadarrService', [
      'getConfig', 'getProfiles', 'getRootFolders', 'getTags', 'saveConfig', 'clearConfig',
    ]);
    service.getProfiles.and.returnValue(of([{ id: 1, name: 'HD' }]));
    service.getRootFolders.and.returnValue(of([{ path: '/movies', free_space: 0, accessible: true }]));
    service.getTags.and.returnValue(of([{ id: 7, label: 'gaps' }, { id: 2, label: 'requests' }]));
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [RadarrSettingsComponent],
      providers: [{ provide: RadarrService, useValue: service }],
    }).compileComponents();
    fixture = TestBed.createComponent(RadarrSettingsComponent);
    component = fixture.componentInstance;
    service.getConfig.and.returnValue(of({
      ...component.config, enabled: true, url: 'http://radarr.test', api_key: 'key', tags: [7],
    }));
    service.saveConfig.and.callFake(config => of({ ...component.config, ...config }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads selected tags and saves multiple selections as numeric IDs', () => {
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#radarrTags');
    expect(Array.from(select.selectedOptions).map(option => option.textContent?.trim())).toEqual(['gaps']);
    Array.from(select.options).forEach(option => option.selected = true);
    select.dispatchEvent(new Event('change'));
    component.saveConfig();
    expect(service.saveConfig.calls.mostRecent().args[0].tags).toEqual([7, 2]);
  });

  it('allows all tags to be deselected', () => {
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#radarrTags');
    Array.from(select.options).forEach(option => option.selected = false);
    select.dispatchEvent(new Event('change'));
    component.saveConfig();
    expect(service.saveConfig.calls.mostRecent().args[0].tags).toEqual([]);
  });

  it('keeps saved tags and other defaults usable when tags cannot load', async () => {
    service.getTags.and.returnValue(throwError(() => ({ error: { error: 'Radarr offline' } })));
    component.loadMeta();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.config.tags).toEqual([7]);
    expect(component.tagsError).toBe('Radarr offline');
    expect(component.profiles[0].id).toBe(1);
    expect(component.rootFolders[0].path).toBe('/movies');
    expect(fixture.nativeElement.querySelector('#radarrTags').disabled).toBeTrue();
    component.saveConfig();
    expect(service.saveConfig.calls.mostRecent().args[0].tags).toEqual([7]);
  });

  it('waits for tags and refreshes options without resetting saved IDs', () => {
    const tags = new Subject<RadarrTag[]>();
    service.getTags.and.returnValue(tags);
    component.loadMeta();
    expect(component.loadingMeta).toBeTrue();
    tags.next([{ id: 7, label: 'renamed' }]);
    tags.complete();
    expect(component.loadingMeta).toBeFalse();
    expect(component.tags).toEqual([{ id: 7, label: 'renamed' }]);
    expect(component.config.tags).toEqual([7]);
  });

  it('shows unavailable saved tags so they can be deselected', async () => {
    service.getTags.and.returnValue(of([]));
    component.loadMeta();
    fixture.detectChanges();
    await fixture.whenStable();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#radarrTags');
    expect(select.selectedOptions[0].textContent).toContain('Unavailable tag (ID 7)');
    select.options[0].selected = false;
    select.dispatchEvent(new Event('change'));
    expect(component.config.tags).toEqual([]);
  });

  it('clears selected tags and options when configuration is cleared', () => {
    service.clearConfig.and.returnValue(of({ message: 'Cleared' }));
    component.clearConfig();
    expect(component.config.tags).toEqual([]);
    expect(component.tags).toEqual([]);
    expect(component.tagsError).toBe('');
  });
});
