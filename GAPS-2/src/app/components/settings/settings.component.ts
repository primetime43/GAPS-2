import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit {
  activeTab: string;

  constructor(private router: Router, private route: ActivatedRoute) {
    // Listen for route changes and update the active tab
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      const activeChild = this.route.firstChild;
      if (activeChild) {
        this.activeTab = activeChild.snapshot.url[0].path;
      }
    });
  }

  ngOnInit() {
    // Defaults the settings page to 'tmdbTab' when this page loads
  this.activeTab = 'tmdbTab';
  this.router.navigate(['/settings/tmdb']); // Navigate to the default tab
  }
}
