import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';


import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { RouteReuseStrategy } from '@angular/router';
import { ReusableRouteStrategy } from './reusable-route.strategy';
import { HeaderComponent } from './components/header/header.component';
import { RecommendedComponent } from './components/recommended/recommended.component';
import { ActorsComponent } from './components/actors/actors.component';
import { AboutComponent } from './components/about/about.component';
import { IndexComponent } from './index/index.component';
import { PlexSettingsComponent } from './components/settings/plex-settings/plex-settings.component';
import { JellyfinSettingsComponent } from './components/settings/jellyfin-settings/jellyfin-settings.component';
import { EmbySettingsComponent } from './components/settings/emby-settings/emby-settings.component';
import { UserPreferencesSettingsComponent } from './components/settings/user-preferences-settings/user-preferences-settings.component';
import { TmdbSettingsComponent } from './components/settings/tmdb-settings/tmdb-settings.component';
import { ImdbSettingsComponent } from './components/settings/imdb-settings/imdb-settings.component';
import { SettingsComponent } from './components/settings/settings.component';
import { ScheduleSettingsComponent } from './components/settings/schedule-settings/schedule-settings.component';
import { NotificationSettingsComponent } from './components/settings/notification-settings/notification-settings.component';
import { RadarrSettingsComponent } from './components/settings/radarr-settings/radarr-settings.component';
import { SonarrSettingsComponent } from './components/settings/sonarr-settings/sonarr-settings.component';
import { TvdbSettingsComponent } from './components/settings/tvdb-settings/tvdb-settings.component';
import { ConfirmModalComponent } from './components/confirm-modal/confirm-modal.component';
import { ScanHistoryComponent } from './components/scan-history/scan-history.component';
import { LogsComponent } from './components/logs/logs.component';
import { CompactNumberPipe } from './pipes/compact-number.pipe';

@NgModule({ declarations: [
        AppComponent,
        HeaderComponent,
        ConfirmModalComponent,
        ScanHistoryComponent,
        RecommendedComponent,
        ActorsComponent,
        AboutComponent,
        IndexComponent,
        PlexSettingsComponent,
        JellyfinSettingsComponent,
        EmbySettingsComponent,
        UserPreferencesSettingsComponent,
        TmdbSettingsComponent,
        ImdbSettingsComponent,
        ScheduleSettingsComponent,
        NotificationSettingsComponent,
        RadarrSettingsComponent,
        SonarrSettingsComponent,
        TvdbSettingsComponent,
        SettingsComponent,
        LogsComponent,
        CompactNumberPipe
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        ReactiveFormsModule,
        FormsModule], providers: [
        provideHttpClient(withInterceptorsFromDi()),
        { provide: RouteReuseStrategy, useClass: ReusableRouteStrategy },
    ] })
export class AppModule { }
