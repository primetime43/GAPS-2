import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';


import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HeaderComponent } from './components/header/header.component';
import { RecommendedComponent } from './components/recommended/recommended.component';
import { UpdatesComponent } from './components/updates/updates.component';
import { AboutComponent } from './components/about/about.component';
import { IndexComponent } from './index/index.component';
import { PlexSettingsComponent } from './components/settings/plex-settings/plex-settings.component';
import { JellyfinSettingsComponent } from './components/settings/jellyfin-settings/jellyfin-settings.component';
import { EmbySettingsComponent } from './components/settings/emby-settings/emby-settings.component';
import { UserPreferencesSettingsComponent } from './components/settings/user-preferences-settings/user-preferences-settings.component';
import { TmdbSettingsComponent } from './components/settings/tmdb-settings/tmdb-settings.component';
import { SettingsComponent } from './components/settings/settings.component';
import { ConfirmModalComponent } from './components/confirm-modal/confirm-modal.component';

@NgModule({ declarations: [
        AppComponent,
        HeaderComponent,
        ConfirmModalComponent,
        RecommendedComponent,
        UpdatesComponent,
        AboutComponent,
        IndexComponent,
        PlexSettingsComponent,
        JellyfinSettingsComponent,
        EmbySettingsComponent,
        UserPreferencesSettingsComponent,
        TmdbSettingsComponent,
        SettingsComponent
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        AppRoutingModule,
        ReactiveFormsModule,
        FormsModule], providers: [provideHttpClient(withInterceptorsFromDi())] })
export class AppModule { }
