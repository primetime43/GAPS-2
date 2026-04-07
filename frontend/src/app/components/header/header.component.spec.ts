import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HeaderComponent } from './header.component';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      declarations: [HeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render navigation links for Dashboard, Missing, Settings, Logs, and About', () => {
    const el = fixture.nativeElement as HTMLElement;
    const linkTexts = Array.from(el.querySelectorAll('a.nav-link'))
      .map(a => a.textContent?.trim());

    expect(linkTexts.some(t => t?.includes('Dashboard'))).toBeTrue();
    expect(linkTexts.some(t => t?.includes('Missing'))).toBeTrue();
    expect(linkTexts.some(t => t?.includes('Settings'))).toBeTrue();
    expect(linkTexts.some(t => t?.includes('Logs'))).toBeTrue();
    expect(linkTexts.some(t => t?.includes('About'))).toBeTrue();
  });

  it('should render the logo image linking to home', () => {
    const el = fixture.nativeElement as HTMLElement;
    const logoLink = el.querySelector('a[ng-reflect-router-link="/"]');
    const logoImg = el.querySelector('img[src*="final-gaps"]');
    expect(logoLink).toBeTruthy();
    expect(logoImg).toBeTruthy();
  });
});
