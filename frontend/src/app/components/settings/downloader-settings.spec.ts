import { of, Subject, throwError } from 'rxjs';
import { RadarrSettingsComponent } from './radarr-settings/radarr-settings.component';
import { SonarrSettingsComponent } from './sonarr-settings/sonarr-settings.component';

for (const Component of [RadarrSettingsComponent, SonarrSettingsComponent]) {
  describe(Component.name, () => {
    let component: RadarrSettingsComponent | SonarrSettingsComponent;
    let service: any;

    beforeEach(() => {
      service = jasmine.createSpyObj('Downloader', ['getProfiles', 'getRootFolders', 'getTags', 'saveConfig']);
      service.getProfiles.and.returnValue(of([{ id: 2, name: 'New profile' }]));
      service.getRootFolders.and.returnValue(of([{ path: '/new', free_space: 0, accessible: true }]));
      service.getTags.and.returnValue(of([]));
      component = new Component(service);
    });

    it('refreshes existing profiles and folders after saving connection settings', () => {
      component.config = { ...component.config, enabled: true, url: 'http://new.test', api_key: 'key' };
      component.profiles = [{ id: 1, name: 'Old profile' }];
      component.rootFolders = [{ path: '/old', free_space: 0, accessible: true }];
      service.saveConfig.and.returnValue(of(component.config));
      component.saveConfig();
      expect(component.profiles[0].id).toBe(2);
      expect(component.rootFolders[0].path).toBe('/new');
    });

    it('keeps metadata loading until all requests finish', () => {
      const folders = new Subject<any>();
      service.getRootFolders.and.returnValue(folders);
      component.loadMeta();
      expect(component.loadingMeta).toBeTrue();
      folders.next([]);
      folders.complete();
      expect(component.loadingMeta).toBeFalse();
    });

    it('reports root folder errors and clears stale options', () => {
      component.rootFolders = [{ path: '/old', free_space: 0, accessible: true }];
      service.getRootFolders.and.returnValue(throwError(() => ({ error: { error: 'Folders unavailable' } })));
      component.loadMeta();
      expect(component.rootFolders).toEqual([]);
      expect(component.message).toBe('Folders unavailable');
      expect(component.messageType).toBe('error');
      expect(component.loadingMeta).toBeFalse();
    });
  });
}
