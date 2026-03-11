import { Component, OnInit } from '@angular/core';
import { PreferencesService, UserPreferences } from '../../../services/preferences.service';
import { PlexService } from '../../../services/plex.service';
import { PlexLibrary } from '../../../models/plex.model';

@Component({
    selector: 'app-user-preferences-settings',
    templateUrl: './user-preferences-settings.component.html',
    styleUrls: ['./user-preferences-settings.component.scss'],
    standalone: false
})
export class UserPreferencesSettingsComponent implements OnInit {
  prefs: UserPreferences = {
    defaultLibrary: '',
    moviesPerPage: 50,
    hideOwnedByDefault: false,
    language: 'en',
    port: 5000,
    autoOpenBrowser: true,
  };

  libraries: PlexLibrary[] = [];
  saving = false;
  saved = false;
  loading = true;

  languages = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ru', name: 'Russian' },
    { code: 'nl', name: 'Dutch' },
    { code: 'sv', name: 'Swedish' },
    { code: 'da', name: 'Danish' },
    { code: 'no', name: 'Norwegian' },
    { code: 'pl', name: 'Polish' },
  ];

  pageSizeOptions = [25, 50, 100, 200];

  constructor(
    private preferencesService: PreferencesService,
    private plexService: PlexService,
  ) {}

  ngOnInit(): void {
    this.preferencesService.load().subscribe({
      next: (prefs) => {
        this.prefs = { ...prefs };
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });

    this.plexService.getActiveServer().subscribe({
      next: (res) => {
        if (res && res.libraries) {
          this.libraries = res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie');
        }
      },
      error: () => {}
    });
  }

  save(): void {
    this.saving = true;
    this.saved = false;
    this.preferencesService.save(this.prefs).subscribe({
      next: (saved) => {
        this.prefs = { ...saved };
        this.saving = false;
        this.saved = true;
        setTimeout(() => this.saved = false, 3000);
      },
      error: () => {
        this.saving = false;
      }
    });
  }
}
