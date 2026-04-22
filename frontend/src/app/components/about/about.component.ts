import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { environment } from '../../../environments/environment';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  bodyHtml?: string;
}

@Component({
    selector: 'app-about',
    templateUrl: './about.component.html',
    styleUrls: ['./about.component.scss'],
    standalone: false
})
export class AboutComponent implements OnInit {
  version = environment.version;
  commit = '';
  releases: GitHubRelease[] = [];
  releasesLoading = true;
  releasesError = '';

  constructor(private http: HttpClient) {}

  get shortCommit(): string {
    return this.commit ? this.commit.slice(0, 7) : '';
  }

  get commitUrl(): string {
    return this.commit && this.commit !== 'dev'
      ? `https://github.com/primetime43/GAPS-2/commit/${this.commit}`
      : '';
  }

  ngOnInit(): void {
    this.http.get<{ version: string; commit: string }>('/api/about').subscribe({
      next: (res) => {
        this.version = res.version || this.version;
        this.commit = res.commit || '';
      },
      error: () => {}
    });

    this.http.get<GitHubRelease[]>(
      'https://api.github.com/repos/primetime43/GAPS-2/releases'
    ).subscribe({
      next: (data) => {
        this.releases = data.map(r => ({
          ...r,
          bodyHtml: marked.parse(r.body || '', { async: false }) as string,
        }));
        this.releasesLoading = false;
      },
      error: () => {
        this.releasesError = 'Could not load releases from GitHub.';
        this.releasesLoading = false;
      }
    });
  }
}
