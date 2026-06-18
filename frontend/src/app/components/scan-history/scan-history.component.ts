import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ScanHistoryEntry,
  ScanHistoryEntryDetail,
  ScanHistoryGap,
  ScanHistoryService,
} from '../../services/scan-history.service';

type MediaTypeFilter = 'all' | 'movie' | 'tv';
type ExportFormat = 'csv' | 'xlsx';

@Component({
  selector: 'app-scan-history',
  templateUrl: './scan-history.component.html',
  styleUrls: ['./scan-history.component.scss'],
  standalone: false,
})
export class ScanHistoryComponent implements OnInit, OnDestroy {
  loading = false;
  error = '';
  entries: ScanHistoryEntry[] = [];
  mediaTypeFilter: MediaTypeFilter = 'all';

  // Per-row export state, keyed by entry.id.
  exportingFor: Record<string, ExportFormat | null> = {};
  rowError: Record<string, string> = {};

  private destroy$ = new Subject<void>();

  constructor(
    private scanHistoryService: ScanHistoryService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        const type = params.get('type');
        this.mediaTypeFilter =
          type === 'movie' || type === 'tv' ? type : 'all';
        this.load();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    this.error = '';
    const filter =
      this.mediaTypeFilter === 'all' ? undefined : this.mediaTypeFilter;
    this.scanHistoryService.get(filter, 50).subscribe({
      next: (resp) => {
        this.entries = resp.history || [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error || 'Failed to load scan history.';
        this.loading = false;
      },
    });
  }

  setFilter(filter: MediaTypeFilter): void {
    if (this.mediaTypeFilter === filter) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filter === 'all' ? { type: null } : { type: filter },
      queryParamsHandling: 'merge',
    });
  }

  canExport(entry: ScanHistoryEntry): boolean {
    return !!entry.id && !!entry.hasGaps && entry.status === 'success';
  }

  exportTooltip(entry: ScanHistoryEntry, format: ExportFormat): string {
    if (!entry.id || !entry.hasGaps) {
      return 'No gap details stored for this scan — re-run the scan to enable export.';
    }
    return `Export this scan's gap list as ${format.toUpperCase()}`;
  }

  exportRow(entry: ScanHistoryEntry, format: ExportFormat): void {
    if (!entry.id || !this.canExport(entry)) return;
    const id = entry.id;
    this.exportingFor[id] = format;
    delete this.rowError[id];

    this.scanHistoryService.getById(id).subscribe({
      next: (detail) => {
        this.exportingFor[id] = null;
        if (!detail.gaps || detail.gaps.length === 0) {
          this.rowError[id] = 'No gap details stored for this scan.';
          return;
        }
        this.writeWorkbook(detail, format).catch(() => {
          this.rowError[id] = 'Failed to build the export file.';
        });
      },
      error: (err) => {
        this.exportingFor[id] = null;
        this.rowError[id] = err?.error?.error || 'Failed to load gaps.';
      },
    });
  }

  isExporting(entry: ScanHistoryEntry, format: ExportFormat): boolean {
    return !!entry.id && this.exportingFor[entry.id] === format;
  }

  private async writeWorkbook(detail: ScanHistoryEntryDetail, format: ExportFormat): Promise<void> {
    // Load xlsx lazily so it stays out of the main bundle (see ExportService).
    const XLSX = await import('xlsx');
    const isTv = detail.mediaType === 'tv';
    const rows = detail.gaps.map((g: ScanHistoryGap) => ({
      Group: (isTv ? g.franchiseName : g.collectionName) || '',
      Title: g.name,
      Year: String(g.year ?? ''),
      ID: isTv ? g.tvdbId : g.tmdbId,
      Owned: g.owned ? 'Yes' : 'No',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gaps');

    const dateStr = (detail.timestamp || '').replace(/[:.]/g, '-').slice(0, 19);
    const prefix = isTv ? 'tv-scan' : 'movie-scan';
    const filename = `${prefix}-${dateStr || 'export'}.${format}`;
    XLSX.writeFile(wb, filename, { bookType: format });
  }
}
