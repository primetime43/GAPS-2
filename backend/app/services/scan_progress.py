"""Thread-safe scan-progress state + monotonic cancellation token.

The movie (TMDB) and TV (TheTVDB) scan services share identical progress
plumbing — a lock-guarded progress dict plus a monotonic generation token so a
freshly started (or cancelled) scan makes the previous worker stop and discard
its results the moment it notices the token changed.

They differ only in:
  * the media-specific progress fields (`current_movie`/`collections_found` for
    movies; `phase`/`current_show`/`franchises_found` for TV), passed as
    `extra_fields` with their reset values, and
  * the config_store key of the last persisted scan (`seed_key`), used to
    rehydrate a 'done' state on startup so the dashboard survives a restart.

Generation semantics mirror the original inline code exactly: a `generation` of
`None` means "not tied to a tracked scan" (e.g. a scheduled scan calling the
gap finder directly) and is treated as always-current, so its progress writes
are unconditional. A real (int) generation is guarded — writes apply only while
it's still the active scan.
"""

import threading

from app.services import config_store


class ScanProgressTracker:
    def __init__(self, *, extra_fields: dict, seed_key: str):
        self._extra_fields = dict(extra_fields)
        self._seed_key = seed_key
        self._lock = threading.Lock()
        self._generation = 0
        self._progress = self._initial_progress()

    def _base_progress(self) -> dict:
        """A fresh idle progress dict with the media-specific fields reset."""
        return {
            'status': 'idle',    # idle | scanning | done | error | cancelled
            'processed': 0,
            'total': 0,
            'gaps': [],
            'total_owned': 0,
            'libraries': [],
            'completed_at': None,
            'error': None,
            **self._extra_fields,
        }

    def _initial_progress(self) -> dict:
        progress = self._base_progress()
        last = config_store.get(self._seed_key)
        if last:
            progress['status'] = 'done'
            progress['gaps'] = last.get('gaps', [])
            progress['total_owned'] = last.get('total_owned', 0)
            progress['libraries'] = last.get('libraries', [])
            progress['completed_at'] = last.get('completed_at')
        return progress

    @property
    def snapshot(self) -> dict:
        """A copy of the current progress dict, safe to hand to a request."""
        with self._lock:
            return dict(self._progress)

    def begin(self, *, total: int, total_owned: int, libraries: list[str]) -> int:
        """Start a new scan generation and return its token. Bumps the token
        first so any still-winding-down previous scan stops and is ignored."""
        with self._lock:
            self._generation += 1
            self._progress = self._base_progress()
            self._progress.update({
                'status': 'scanning',
                'total': total,
                'total_owned': total_owned,
                'libraries': list(libraries),
            })
            return self._generation

    def cancel(self) -> bool:
        """Stop the running scan. Returns True if one was running."""
        with self._lock:
            if self._progress['status'] != 'scanning':
                return False
            self._generation += 1
            self._progress = self._base_progress()
            self._progress['status'] = 'cancelled'
            return True

    def is_current(self, generation: int | None) -> bool:
        """Whether `generation` still owns the tracker. `None` is always current
        (untracked direct calls); a real token must match the active scan."""
        if generation is None:
            return True
        with self._lock:
            return self._generation == generation

    def update(self, generation: int | None, **fields) -> bool:
        """Apply partial field updates to the live progress dict, unless a newer
        generation has superseded `generation`. Returns whether it applied."""
        with self._lock:
            if generation is not None and self._generation != generation:
                return False
            self._progress.update(fields)
            return True

    def finish(self, generation: int, *, gaps: list, total_owned: int, completed_at: str) -> bool:
        """Mark the scan done with its results, unless superseded."""
        with self._lock:
            if self._generation != generation:
                return False
            self._progress['gaps'] = gaps
            self._progress['total_owned'] = total_owned
            self._progress['completed_at'] = completed_at
            self._progress['status'] = 'done'
            return True

    def fail(self, generation: int, error: str) -> None:
        """Mark the scan errored, unless superseded."""
        with self._lock:
            if self._generation == generation:
                self._progress['error'] = error
                self._progress['status'] = 'error'
