import { ComponentFixture, TestBed } from '@angular/core/testing';

import { JellyfinSettingsComponent } from './jellyfin-settings.component';

describe('JellyfinSettingsComponent', () => {
  let component: JellyfinSettingsComponent;
  let fixture: ComponentFixture<JellyfinSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [JellyfinSettingsComponent]
    });
    fixture = TestBed.createComponent(JellyfinSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
