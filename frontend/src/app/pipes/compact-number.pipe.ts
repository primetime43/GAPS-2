import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats large counts compactly (e.g. 38377 → "38K", 2253715 → "2.3M").
 * Used for vote counts shown next to ratings on movie cards.
 */
@Pipe({ name: 'compactNumber', standalone: false })
export class CompactNumberPipe implements PipeTransform {
  private static readonly formatter = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || isNaN(value)) return '';
    return CompactNumberPipe.formatter.format(value);
  }
}
