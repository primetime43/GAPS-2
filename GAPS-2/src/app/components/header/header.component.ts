import { Component, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';

@Component({
  selector: 'app-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit {
  librariesPage = false;
  recommendedPage = false;
  settingsPage = false;
  aboutPage = false;
  updatesPage = false;

  constructor(private router: Router) {
    // Listen for route changes
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.updateActivePage(event.urlAfterRedirects || event.url);
      }
    });
  }

  ngOnInit(): void {
    this.updateActivePage(this.router.url);
  }

  private updateActivePage(url: string): void {
    this.librariesPage = url.includes('libraries');
    this.recommendedPage = url.includes('recommended');
    this.settingsPage = url.includes('settings');
    this.aboutPage = url.includes('about');
    this.updatesPage = url.includes('updates');
  }

  goToSettings(): void {
    this.router.navigate(['/settings/tmdb']);
  }
}
