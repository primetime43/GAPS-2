import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserPreferencesSettingsComponent } from './user-preferences-settings.component';

describe('UserPreferencesSettingsComponent', () => {
  let component: UserPreferencesSettingsComponent;
  let fixture: ComponentFixture<UserPreferencesSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [UserPreferencesSettingsComponent]
    });
    fixture = TestBed.createComponent(UserPreferencesSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
