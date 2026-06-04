import { Component, OnInit } from '@angular/core';
import { PreferencesService, UserPreferences, DEFAULT_PREFERENCES } from '../../../services/preferences.service';
import { ActiveServerService } from '../../../services/active-server.service';
import { MediaLibrary } from '../../../models/media-server.model';

@Component({
    selector: 'app-user-preferences-settings',
    templateUrl: './user-preferences-settings.component.html',
    styleUrls: ['./user-preferences-settings.component.scss'],
    standalone: false
})
export class UserPreferencesSettingsComponent implements OnInit {
  prefs: UserPreferences = { ...DEFAULT_PREFERENCES };

  libraries: MediaLibrary[] = [];
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

  // Collapsible preference sections; all expanded by default. Persisted to
  // localStorage (pure UI state — not worth a round-trip to the backend prefs).
  private static readonly COLLAPSED_KEY = 'gaps2.prefSectionsCollapsed';
  collapsedSections: Record<string, boolean> = this.loadCollapsedSections();

  toggleSection(key: string): void {
    this.collapsedSections[key] = !this.collapsedSections[key];
    this.saveCollapsedSections();
  }

  isCollapsed(key: string): boolean {
    return !!this.collapsedSections[key];
  }

  private loadCollapsedSections(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(UserPreferencesSettingsComponent.COLLAPSED_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private saveCollapsedSections(): void {
    try {
      localStorage.setItem(
        UserPreferencesSettingsComponent.COLLAPSED_KEY,
        JSON.stringify(this.collapsedSections),
      );
    } catch {
      // Ignore storage failures (private mode / quota) — collapse is non-critical.
    }
  }

  constructor(
    private preferencesService: PreferencesService,
    private activeServerService: ActiveServerService,
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

    // Check the active media server for movie libraries
    this.activeServerService.getActive().subscribe((active) => {
      if (active) {
        this.libraries = active.libraries.filter((lib: MediaLibrary) => lib.type === 'movie');
      }
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
