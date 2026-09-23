import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { BuildInfo } from '../../services/update.service';

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
  build: BuildInfo | null = null;
  releases: GitHubRelease[] = [];
  releasesLoading = true;
  releasesError = '';
  readonly releasesPerPage = 5;
  releasePage = 1;

  constructor(private http: HttpClient) {}

  get shortCommit(): string {
    return this.commit ? this.commit.slice(0, 7) : '';
  }

  get commitUrl(): string {
    return this.commit && this.commit !== 'dev'
      ? `https://github.com/primetime43/GAPS-2/commit/${this.commit}`
      : '';
  }

  get releasePageCount(): number {
    return Math.ceil(this.releases.length / this.releasesPerPage);
  }

  get visibleReleases(): GitHubRelease[] {
    const start = (this.releasePage - 1) * this.releasesPerPage;
    return this.releases.slice(start, start + this.releasesPerPage);
  }

  setReleasePage(page: number): void {
    if (page < 1 || page > this.releasePageCount) return;
    this.releasePage = page;
  }

  ngOnInit(): void {
    this.http.get<BuildInfo>('/api/about').subscribe({
      next: (res) => {
        this.build = res;
        this.version = res.version || this.version;
        this.commit = res.commit || '';
      },
      error: () => {}
    });

    this.http.get<GitHubRelease[]>(
      'https://api.github.com/repos/primetime43/GAPS-2/releases'
    ).subscribe({
      next: async (data) => {
        // Lazy-load marked only when the releases list renders (keeps it out of
        // the main bundle).
        const { marked } = await import('marked');
        this.releases = data.map(r => ({
          ...r,
          bodyHtml: marked.parse(r.body || '', { async: false }) as string,
        }));
        this.releasePage = 1;
        this.releasesLoading = false;
      },
      error: () => {
        this.releasesError = 'Could not load releases from GitHub.';
        this.releasesLoading = false;
      }
    });
  }
}
