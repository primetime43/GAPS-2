import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ScheduleLastRun } from '../../services/schedule.service';

interface TrendPoint {
  run: ScheduleLastRun;
  time: number;
  x: number;
  y: number;
}
interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: TrendPoint[];
  path: string;
  change: string;
}

@Component({
  selector: 'app-schedule-history',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './schedule-history.component.html',
  styleUrls: ['./schedule-history.component.scss'],
})
export class ScheduleHistoryComponent implements OnChanges {
  @Input() runs: ScheduleLastRun[] = [];
  @Input() retentionLimit = 50;
  @Input() saving = false;
  @Input() error = '';
  @Input() message = '';
  @Output() retentionChange = new EventEmitter<number>();

  draftLimit = 50;
  page = 1;
  readonly pageSize = 10;
  groupFilter = '';
  groups: { key: string; label: string }[] = [];
  filteredRuns: ScheduleLastRun[] = [];
  series: TrendSeries[] = [];
  yTicks: { value: number; y: number }[] = [];
  xTicks: { time: number; x: number }[] = [];
  activePoint: { label: string; run: ScheduleLastRun } | null = null;
  private readonly colors = ['#00d6a0', '#65bfff', '#ffc857', '#e794d6', '#c0b4ff', '#ff9a76'];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['retentionLimit']) this.draftLimit = this.retentionLimit;
    if (changes['runs']) {
      const groups = new Map<string, string>();
      for (const run of this.runs) groups.set(this.groupKey(run), this.groupLabel(run));
      this.groups = Array.from(groups, ([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
      if (!groups.has(this.groupFilter)) this.groupFilter = '';
      this.refresh();
    }
  }

  get validLimit(): boolean {
    return Number.isInteger(this.draftLimit) && this.draftLimit >= 10 && this.draftLimit <= 500;
  }
  get pageCount(): number { return Math.max(1, Math.ceil(this.filteredRuns.length / this.pageSize)); }
  get pageRows(): ScheduleLastRun[] { return this.filteredRuns.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  get firstRow(): number { return this.filteredRuns.length ? (this.page - 1) * this.pageSize + 1 : 0; }
  get lastRow(): number { return Math.min(this.page * this.pageSize, this.filteredRuns.length); }

  saveLimit(): void {
    if (this.validLimit && !this.saving) this.retentionChange.emit(this.draftLimit);
  }

  refresh(): void {
    this.page = 1;
    this.activePoint = null;
    this.filteredRuns = this.runs.filter(run => !this.groupFilter || this.groupKey(run) === this.groupFilter)
      .slice().sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
    this.buildChart();
  }

  private groupKey(run: ScheduleLastRun): string {
    const libraries = run.libraries?.length ? [...new Set(run.libraries)].sort() : [run.library || 'Unknown library'];
    return JSON.stringify([run.mediaType || 'movie', run.source || '', run.server || '', libraries]);
  }

  private groupLabel(run: ScheduleLastRun): string {
    const libraries = run.libraries?.length ? [...new Set(run.libraries)].sort().join(', ') : run.library || 'Unknown library';
    const origin = [run.source, run.server].filter(Boolean).join(' / ') || 'older scans';
    return `${run.mediaType === 'tv' ? 'TV' : 'Movies'} · ${libraries} · ${origin}`;
  }

  private buildChart(): void {
    const groups = new Map<string, TrendSeries>();
    // Failed/skipped scans and missing counts are not zero-valued observations.
    for (const run of [...this.filteredRuns].reverse()) {
      const time = Date.parse(run.timestamp);
      if (run.status !== 'success' || !Number.isFinite(time) || !Number.isInteger(run.missing) || run.missing < 0) continue;
      const key = this.groupKey(run);
      if (!groups.has(key)) groups.set(key, {
        key, label: this.groupLabel(run), color: '', points: [], path: '', change: '',
      });
      groups.get(key)!.points.push({ run, time, x: 0, y: 0 });
    }
    this.series = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    const points = this.series.flatMap(series => series.points);
    if (!points.length) { this.xTicks = []; this.yTicks = []; return; }
    const minTime = Math.min(...points.map(point => point.time));
    const maxTime = Math.max(...points.map(point => point.time));
    const maxCount = Math.max(1, ...points.map(point => point.run.missing));
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxCount / 4)));
    const step = Math.max(1, Math.ceil(maxCount / 4 / magnitude) * magnitude);
    const top = step * 4;
    this.yTicks = Array.from({ length: 5 }, (_, i) => ({ value: step * i, y: 240 - i * 52 }));
    this.xTicks = minTime === maxTime ? [{ time: minTime, x: 475 }]
      : [0, 0.5, 1].map(fraction => ({ time: minTime + (maxTime - minTime) * fraction, x: 65 + 820 * fraction }));
    this.series.forEach((series, index) => {
      series.color = this.colors[index % this.colors.length];
      for (const point of series.points) {
        point.x = maxTime === minTime ? 475 : 65 + 820 * (point.time - minTime) / (maxTime - minTime);
        point.y = 240 - 208 * point.run.missing / top;
      }
      series.path = series.points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      const delta = series.points[series.points.length - 1].run.missing - series.points[0].run.missing;
      series.change = series.points.length < 2 ? 'One scan — more scans needed for a trend'
        : delta === 0 ? 'No net change'
        : `${Math.abs(delta).toLocaleString()} ${delta > 0 ? 'more' : 'fewer'} missing`;
    });
  }
}
