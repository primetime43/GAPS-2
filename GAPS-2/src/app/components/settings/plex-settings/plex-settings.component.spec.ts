import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlexSettingsComponent } from './plex-settings.component';

describe('PlexSettingsComponent', () => {
  let component: PlexSettingsComponent;
  let fixture: ComponentFixture<PlexSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [PlexSettingsComponent]
    });
    fixture = TestBed.createComponent(PlexSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
