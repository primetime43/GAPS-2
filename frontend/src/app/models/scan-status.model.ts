/** Lightweight progress shared by movie and TV scans, without result posters. */
export interface ScanStatus {
  status: 'idle' | 'scanning' | 'done' | 'error' | 'cancelled';
  processed: number;
  total: number;
  libraries: string[];
  completed_at: string | null;
  error: string | null;
  current_movie?: string;
  current_show?: string;
  phase?: 'shows' | 'franchises' | 'titles';
}
