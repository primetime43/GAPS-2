import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { CollectionGap } from '../models/recommendation.model';

export type ExportFormat = 'csv' | 'xlsx';

interface ExportRow {
  'Collection': string;
  'Title': string;
  'Year': string;
  'TMDB ID': number;
  'Owned': string;
}

@Injectable({
  providedIn: 'root'
})
export class ExportService {

  exportGaps(gaps: CollectionGap[], format: ExportFormat): void {
    const rows: ExportRow[] = gaps.map(g => ({
      'Collection': g.collectionName,
      'Title': g.name,
      'Year': g.year,
      'TMDB ID': g.tmdbId,
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
