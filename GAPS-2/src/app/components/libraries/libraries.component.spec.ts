import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LibrariesComponent } from './libraries.component';

describe('LibrariesComponent', () => {
  let component: LibrariesComponent;
  let fixture: ComponentFixture<LibrariesComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LibrariesComponent]
    });
    fixture = TestBed.createComponent(LibrariesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
