import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { TmdbService } from '../../../services/tmdb/tmdb.service';

@Component({
  selector: 'app-tmdb-settings',
  templateUrl: './tmdb-settings.component.html',
  styleUrls: ['./tmdb-settings.component.scss']
})
export class TmdbSettingsComponent implements OnInit {
  tmdbForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private tmdbService:
    TmdbService
    ) { }

  ngOnInit(): void {
    this.tmdbForm = this.fb.group({
      movieDbApiKey: [this.tmdbService.getApiKey() || '', Validators.required]
    });
  }

  testTmdbKey() {
    const apiKey = this.tmdbForm.get('movieDbApiKey').value;
    // Your logic to test the API key goes here.
  }

  saveTmdbKey() {
    const apiKey = this.tmdbForm.get('movieDbApiKey').value;
    this.tmdbService.setApiKey(apiKey);
    // Your logic to save the API key goes here.
  }
}
