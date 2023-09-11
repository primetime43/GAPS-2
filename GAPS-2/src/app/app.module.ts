import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';


import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { HttpClientModule } from '@angular/common/http';
import { HeaderComponent } from './components/header/header.component';
import { LibrariesComponent } from './components/libraries/libraries.component';
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

@NgModule({
  declarations: [
    AppComponent,
    HeaderComponent,
    LibrariesComponent,
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
  imports: [
    BrowserModule,
    AppRoutingModule,
    HttpClientModule,
    ReactiveFormsModule,
    FormsModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
