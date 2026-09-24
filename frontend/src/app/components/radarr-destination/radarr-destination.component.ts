import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RadarrService, RadarrRootFolder } from '../../services/radarr.service';

@Component({
  selector: 'app-radarr-destination',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div *ngIf="enabled" class="mb-3">
      <label class="form-label d-block">
        Radarr destination
        <select class="form-select dark-select mt-1" [ngModel]="rootFolderPath"
                (ngModelChange)="rootFolderPathChange.emit($event)" [disabled]="loading">
          <option value="">Automatic — library mapping, then decade / default</option>
          <option *ngFor="let folder of folders" [value]="folder.path" [disabled]="!folder.accessible">{{ folder.path }}</option>
        </select>
      </label>
      <div class="text-muted small">An explicit destination applies to movies you add from these results. Choose one if the selected libraries have different mappings.</div>
      <div *ngIf="error" class="text-danger small" role="alert">{{ error }}</div>
      <button *ngIf="error" type="button" class="btn btn-sm btn-outline-secondary mt-1" (click)="loadFolders()">Retry folders</button>
    </div>
  `,
})
export class RadarrDestinationComponent implements OnInit {
  @Input() rootFolderPath = '';
  @Output() rootFolderPathChange = new EventEmitter<string>();
  enabled = false;
  loading = false;
  folders: RadarrRootFolder[] = [];
  error = '';

  constructor(private radarr: RadarrService) {}

  ngOnInit(): void {
    this.radarr.getConfig().subscribe({
      next: config => {
        this.enabled = !!config?.enabled;
        if (this.enabled) this.loadFolders();
      },
      error: () => {},
    });
  }

  loadFolders(): void {
    this.loading = true;
    this.error = '';
    this.radarr.getRootFolders().subscribe({
      next: folders => { this.folders = folders; this.loading = false; },
      error: () => { this.error = 'Could not load Radarr folders. Automatic routing is still available.'; this.loading = false; },
    });
  }
}
