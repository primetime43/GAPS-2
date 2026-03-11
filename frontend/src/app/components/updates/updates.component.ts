import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  bodyHtml?: SafeHtml;
}

@Component({
    selector: 'app-updates',
    templateUrl: './updates.component.html',
    styleUrls: ['./updates.component.scss'],
    standalone: false
})
export class UpdatesComponent implements OnInit {
  releases: GitHubRelease[] = [];
  loading = true;
  error = '';

  constructor(private http: HttpClient, private sanitizer: DomSanitizer) {}

  ngOnInit(): void {
    this.http.get<GitHubRelease[]>(
      'https://api.github.com/repos/primetime43/GAPS-2/releases'
    ).subscribe({
      next: (data) => {
        this.releases = data.map(r => ({
          ...r,
          bodyHtml: this.sanitizer.bypassSecurityTrustHtml(
            marked.parse(r.body || '', { async: false }) as string
          )
        }));
        this.loading = false;
      },
      error: () => {
        this.error = 'Could not load releases from GitHub.';
        this.loading = false;
      }
    });
  }
}
