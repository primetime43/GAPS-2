import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TmdbService } from '../../../services/tmdb/tmdb.service';

@Component({
    selector: 'app-tmdb-settings',
    templateUrl: './tmdb-settings.component.html',
    styleUrls: ['./tmdb-settings.component.scss'],
    standalone: false
})
export class TmdbSettingsComponent implements OnInit {
  tmdbForm!: FormGroup;
  message = '';
  messageType: 'success' | 'error' | '' = '';
  testing = false;
  saving = false;
  hasKey = false;

  constructor(
    private fb: FormBuilder,
    private tmdbService: TmdbService
  ) {}

  ngOnInit(): void {
    this.hasKey = this.tmdbService.hasApiKey();
    this.tmdbForm = this.fb.group({
      movieDbApiKey: [this.tmdbService.getApiKey() || '', Validators.required]
    });
  }

  testTmdbKey(): void {
    const apiKey = this.tmdbForm.get('movieDbApiKey')?.value;
    if (!apiKey) {
      this.showMessage('Please enter an API key first.', 'error');
      return;
    }

    this.testing = true;
    this.clearMessage();
    this.tmdbService.testApiKey(apiKey).subscribe({
      next: (res) => {
        this.showMessage(res.message || 'API key is working!', 'success');
        this.testing = false;
      },
      error: (err) => {
        const msg = err.error?.message || err.error?.error || 'API key test failed. Check the key and try again.';
        this.showMessage(msg, 'error');
        this.testing = false;
      }
    });
  }

  saveTmdbKey(): void {
    const apiKey = this.tmdbForm.get('movieDbApiKey')?.value;
    if (!apiKey) {
      this.showMessage('Please enter an API key first.', 'error');
      return;
    }

    this.saving = true;
    this.clearMessage();
    this.tmdbService.saveApiKey(apiKey).subscribe({
      next: (res) => {
        this.tmdbService.setApiKey(apiKey);
        this.hasKey = true;
        this.showMessage(res.message || 'API key saved successfully!', 'success');
        this.saving = false;
      },
      error: (err) => {
        const msg = err.error?.message || err.error?.error || 'Failed to save API key.';
        this.showMessage(msg, 'error');
        this.saving = false;
      }
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
