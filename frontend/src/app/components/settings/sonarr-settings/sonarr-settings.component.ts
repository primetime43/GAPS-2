import { Component, OnInit } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import { SonarrService, SonarrConfig, SonarrQualityProfile, SonarrRootFolder, SonarrTag, SonarrLibrary } from '../../../services/sonarr.service';

@Component({
  selector: 'app-sonarr-settings',
  templateUrl: './sonarr-settings.component.html',
  styleUrls: ['./sonarr-settings.component.scss'],
  standalone: false,
})
export class SonarrSettingsComponent implements OnInit {
  config: SonarrConfig = {
    enabled: false,
    url: '',
    api_key: '',
    quality_profile_id: 0,
    root_folder_path: '',
    monitored: true,
    season_folder: true,
    search_on_add: true,
    tags: [],
    library_root_folders: [],
  };
  profiles: SonarrQualityProfile[] = [];
  rootFolders: SonarrRootFolder[] = [];
  tags: SonarrTag[] = [];
  tagsError = '';
  libraries: SonarrLibrary[] = [];
  librariesError = '';
  testing = false;
  saving = false;
  loadingMeta = false;
  showKey = false;
  revealingKey = false;
  message = '';
  messageType: 'success' | 'error' | '' = '';

  private static isMasked(value: string | undefined | null): boolean {
    return !!value && /^•+$/.test(value);
  }

  toggleShowKey(): void {
    if (this.showKey) {
      this.showKey = false;
      return;
    }
    if (!SonarrSettingsComponent.isMasked(this.config.api_key)) {
      this.showKey = true;
      return;
    }
    this.revealingKey = true;
    this.sonarr.getConfig(true).subscribe({
      next: (cfg) => {
        this.config.api_key = cfg.api_key;
        this.showKey = true;
        this.revealingKey = false;
      },
      error: () => {
        this.revealingKey = false;
        this.showKey = true;
      },
    });
  }

  constructor(private sonarr: SonarrService) {}

  hasTag(id: number): boolean {
    return this.tags.some(tag => tag.id === id);
  }

  private sameLibrary(a: SonarrLibrary, b: SonarrLibrary): boolean {
    return a.source === b.source && a.server === b.server && a.library === b.library;
  }

  get mappingLibraries(): SonarrLibrary[] {
    const libraries = [...this.libraries];
    for (const mapping of this.config.library_root_folders || []) {
      if (!libraries.some(library => this.sameLibrary(library, mapping))) libraries.push(mapping);
    }
    return libraries;
  }

  mappedRoot(library: SonarrLibrary): string {
    return (this.config.library_root_folders || []).find(mapping => this.sameLibrary(mapping, library))?.root_folder_path || '';
  }

  setMappedRoot(library: SonarrLibrary, path: string): void {
    this.config.library_root_folders = (this.config.library_root_folders || []).filter(mapping => !this.sameLibrary(mapping, library));
    if (path) this.config.library_root_folders.push({ ...library, root_folder_path: path });
  }

  hasRoot(path: string): boolean {
    return this.rootFolders.some(folder => folder.path === path);
  }

  ngOnInit(): void {
    this.sonarr.getConfig().subscribe({
      next: (cfg) => {
        this.config = cfg;
        if (cfg.enabled) {
          this.loadMeta();
        }
      },
      error: () => {},
    });
  }

  loadMeta(): void {
    this.loadingMeta = true;
    this.profiles = [];
    this.rootFolders = [];
    this.tags = [];
    this.tagsError = '';
    this.libraries = [];
    this.librariesError = '';
    forkJoin({
      profiles: this.sonarr.getProfiles(),
      folders: this.sonarr.getRootFolders(),
      libraries: this.sonarr.getLibraries().pipe(catchError(err => {
        this.librariesError = err.error?.error || 'Could not load media libraries. Saved mappings have been kept.';
        return of([] as SonarrLibrary[]);
      })),
      tags: this.sonarr.getTags().pipe(catchError(err => {
        this.tagsError = err.error?.error || 'Could not load Sonarr tags. Saved tags have been kept.';
        return of([] as SonarrTag[]);
      })),
    }).subscribe({
      next: ({ profiles, folders, tags, libraries }) => {
        this.profiles = profiles;
        this.rootFolders = folders;
        this.tags = tags;
        this.libraries = libraries;
        this.loadingMeta = false;
      },
      error: (err) => {
        this.loadingMeta = false;
        this.showMessage(err.error?.error || 'Could not load quality profiles or root folders', 'error');
      },
    });
  }

  testConnection(): void {
    if (!this.config.url || !this.config.api_key) {
      this.showMessage('URL and API key are required.', 'error');
      return;
    }
    this.testing = true;
    this.clearMessage();
    this.sonarr.testConnection(this.config.url, this.config.api_key).subscribe({
      next: (res) => {
        this.showMessage(res.message, 'success');
        this.testing = false;
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Connection test failed', 'error');
        this.testing = false;
      },
    });
  }

  saveConfig(): void {
    if (!this.config.url || !this.config.api_key) {
      this.showMessage('URL and API key are required.', 'error');
      return;
    }
    this.saving = true;
    this.clearMessage();
    this.sonarr.saveConfig(this.config).subscribe({
      next: (cfg) => {
        this.config = cfg;
        this.showMessage('Sonarr settings saved.', 'success');
        this.saving = false;
        if (cfg.enabled) {
          this.loadMeta();
        }
      },
      error: (err) => {
        this.showMessage(err.error?.error || 'Failed to save settings', 'error');
        this.saving = false;
      },
    });
  }

  clearConfig(): void {
    this.sonarr.clearConfig().subscribe({
      next: () => {
        this.config = {
          enabled: false,
          url: '',
          api_key: '',
          quality_profile_id: 0,
          root_folder_path: '',
          monitored: true,
          season_folder: true,
          search_on_add: true,
          tags: [],
          library_root_folders: [],
        };
        this.profiles = [];
        this.rootFolders = [];
        this.tags = [];
        this.tagsError = '';
        this.libraries = [];
        this.librariesError = '';
        this.showMessage('Sonarr settings cleared.', 'success');
      },
      error: (err) => this.showMessage(err.error?.error || 'Failed to clear settings', 'error'),
    });
  }

  private showMessage(msg: string, type: 'success' | 'error'): void {
    this.message = msg;
    this.messageType = type;
  }

  private clearMessage(): void {
    this.message = '';
    this.messageType = '';
  }
}
