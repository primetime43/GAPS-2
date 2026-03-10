import { Component } from '@angular/core';

@Component({
    selector: 'app-updates',
    templateUrl: './updates.component.html',
    styleUrls: ['./updates.component.scss'],
    standalone: false
})
export class UpdatesComponent {
  version = '2.0.0';
}
