import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TmdbSettingsComponent } from './tmdb-settings.component';

describe('TmdbSettingsComponent', () => {
  let component: TmdbSettingsComponent;
  let fixture: ComponentFixture<TmdbSettingsComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [TmdbSettingsComponent]
    });
    fixture = TestBed.createComponent(TmdbSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
