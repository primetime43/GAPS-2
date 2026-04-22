import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { Subject, Subscription, timer } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { LogService, LogEntry } from '../../services/log.service';

@Component({
  selector: 'app-logs',
  templateUrl: './logs.component.html',
  styleUrls: ['./logs.component.scss'],
  standalone: false
})
export class LogsComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('logContainer') logContainer!: ElementRef;

  entries: LogEntry[] = [];
  filteredEntries: LogEntry[] = [];
  loading = true;
  autoScroll = true;
  autoRefresh = true;
  filterLevel = '';
  searchFilter = '';

  levels = ['', 'DEBUG', 'INFO', 'WARNING', 'ERROR'];

  private refreshSub: Subscription | null = null;
  private destroy$ = new Subject<void>();
  private needsScroll = false;

  constructor(private logService: LogService) {}

  ngOnInit(): void {
    this.fetchLogs();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewChecked(): void {
    if (this.needsScroll && this.autoScroll && this.logContainer) {
      const el = this.logContainer.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.needsScroll = false;
    }
  }

  fetchLogs(): void {
    this.logService.getLogs(this.filterLevel || undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.entries = res.entries;
          this.applySearch();
          this.loading = false;
          this.needsScroll = true;
        },
        error: () => {
          this.loading = false;
        }
      });
  }

  applySearch(): void {
    if (!this.searchFilter) {
      this.filteredEntries = this.entries;
    } else {
      const term = this.searchFilter.toLowerCase();
      this.filteredEntries = this.entries.filter(e =>
        e.message.toLowerCase().includes(term) ||
        e.logger.toLowerCase().includes(term)
      );
    }
  }

  onFilterChange(): void {
    this.fetchLogs();
  }

  onSearchChange(): void {
    this.applySearch();
  }

  clearLogs(): void {
    this.logService.clearLogs().subscribe(() => {
      this.entries = [];
      this.filteredEntries = [];
    });
  }

  toggleAutoRefresh(): void {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.startAutoRefresh();
    } else {
      this.stopAutoRefresh();
    }
  }

  getLevelClass(level: string): string {
    switch (level) {
      case 'ERROR': return 'log-error';
      case 'WARNING': return 'log-warning';
      case 'INFO': return 'log-info';
      case 'DEBUG': return 'log-debug';
      default: return '';
    }
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.refreshSub = timer(3000, 3000).pipe(
      takeUntil(this.destroy$),
      switchMap(() => this.logService.getLogs(this.filterLevel || undefined)),
    ).subscribe({
      next: (res) => {
        this.entries = res.entries;
        this.applySearch();
        this.needsScroll = true;
      },
      error: () => {},
    });
  }

  private stopAutoRefresh(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = null;
  }
}
