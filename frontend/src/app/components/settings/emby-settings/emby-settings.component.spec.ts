import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EmbySettingsComponent } from './emby-settings.component';

describe('EmbySettingsComponent', () => {
  let component: EmbySettingsComponent;
  let fixture: ComponentFixture<EmbySettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EmbySettingsComponent]
    });
    fixture = TestBed.createComponent(EmbySettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
