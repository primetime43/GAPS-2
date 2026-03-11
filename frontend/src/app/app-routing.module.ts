import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { RecommendedComponent } from './components/recommended/recommended.component';
import { UpdatesComponent } from './components/updates/updates.component';
import { AboutComponent } from './components/about/about.component';
import { IndexComponent } from './index/index.component';

//Settings
import { EmbySettingsComponent } from './components/settings/emby-settings/emby-settings.component';
import { TmdbSettingsComponent } from './components/settings/tmdb-settings/tmdb-settings.component';
import { PlexSettingsComponent } from './components/settings/plex-settings/plex-settings.component';
import { JellyfinSettingsComponent } from './components/settings/jellyfin-settings/jellyfin-settings.component';
import { UserPreferencesSettingsComponent } from './components/settings/user-preferences-settings/user-preferences-settings.component';
import { ScheduleSettingsComponent } from './components/settings/schedule-settings/schedule-settings.component';
import { NotificationSettingsComponent } from './components/settings/notification-settings/notification-settings.component';
import { SettingsComponent } from './components/settings/settings.component';

const routes: Routes = [
  { path: '', redirectTo: '/index', pathMatch: 'full' },
  { path: 'recommended', component: RecommendedComponent },
  { path: 'updates', component: UpdatesComponent },
  { path: 'about', component: AboutComponent },
  { path: 'index', component: IndexComponent },
  { path: 'settings', component: SettingsComponent, children: [
    { path: '', redirectTo: 'tmdb', pathMatch: 'full' },
    { path: 'tmdb', component: TmdbSettingsComponent },
    { path: 'plex', component: PlexSettingsComponent },
    { path: 'jellyfin', component: JellyfinSettingsComponent },
    { path: 'emby', component: EmbySettingsComponent },
    { path: 'schedule', component: ScheduleSettingsComponent },
    { path: 'notifications', component: NotificationSettingsComponent },
    { path: 'user-preferences', component: UserPreferencesSettingsComponent },
  ]},
  { path: '**', redirectTo: '/index' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
