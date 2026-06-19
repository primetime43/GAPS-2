import { Injectable } from '@angular/core';
import { Gap } from '../models/recommendation.model';

export type ExportFormat = 'csv' | 'xlsx';

interface ExportRow {
  'Group': string;
  'Title': string;
  'Year': string;
  'ID': number;
  'Owned': string;
}

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  async exportGaps(gaps: Gap[], format: ExportFormat): Promise<void> {
    // Load the heavy xlsx library only when an export actually runs (keeps it
    // out of the main bundle). The await also yields the event loop, so the
    // click handler returns before the synchronous sheet build/write below and
    // the UI stays responsive.
    const XLSX = await import('xlsx');

    const rows: ExportRow[] = gaps.map(g => ({
      'Group': g.groupName,
      'Title': g.name,
      'Year': String(g.year),
      'ID': g.id,
      'Owned': g.owned ? 'Yes' : 'No',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gaps');

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `gaps-export-${timestamp}.${format}`;

    if (format === 'csv') {
      XLSX.writeFile(wb, filename, { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
    }
  }
}
