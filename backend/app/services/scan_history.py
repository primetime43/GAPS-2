"""Unified scan history shared by manual and scheduled scans, movies and TV.

Each completed scan appends a single entry so the dashboard can render a
"recent scans" list across both media types and the scan-history page can
export the gaps that were found.
"""

import logging
import threading
import uuid
from datetime import datetime, timezone

from app.services import config_store

logger = logging.getLogger(__name__)

HISTORY_KEY = 'scan_history'
MAX_HISTORY = 50

# Serializes record()'s load/insert/put so two scans completing concurrently
# (e.g. scheduled movie + TV jobs, or a manual scan finishing alongside a
# scheduled one) can't both load the same history and lose one entry when the
# later put() overwrites the earlier.
_RECORD_LOCK = threading.Lock()


def _is_future_release(gap: dict, is_movie: bool, today: str, current_year: int) -> bool:
    """Mirror the dashboard's future-release check (recommended.component).

    Prefer an exact date (movie release / TV first-aired); a movie with no date
    is treated as unannounced/future, while TV falls back to the year.
    """
    release_date = gap.get('releaseDate') or ''
    if release_date:
        return release_date[:10] > today
    if is_movie:
        return True
    try:
        year = int(str(gap.get('year'))[:4])
    except (TypeError, ValueError):
        return False
    return year > current_year


def actionable_missing(media_type: str, gaps: list[dict]) -> list[dict]:
    """Filter a not-owned 'missing' list down to the gaps a user would act on,
    the same way the dashboard does — so manual and scheduled scans report
    identical counts (issue #47 follow-up):

    - the ignore list (`ignored_movies`/`ignored_shows`) is always applied;
    - future releases are dropped when `hideFutureReleasesByDefault` is set.

    Quality filtering already happened at scan time, so it isn't repeated here.
    """
    is_movie = media_type != 'tv'
    id_key = 'tmdbId' if is_movie else 'tvdbId'
    ignored_key = 'ignored_movies' if is_movie else 'ignored_shows'
    ignored = set(config_store.get(ignored_key, []) or [])
    result = [g for g in gaps if g.get(id_key) not in ignored]

    prefs = config_store.get('preferences', {}) or {}
    if prefs.get('hideFutureReleasesByDefault'):
        now = datetime.now(timezone.utc)
        today = now.strftime('%Y-%m-%d')
        result = [g for g in result if not _is_future_release(g, is_movie, today, now.year)]
    return result


def _strip_gap(media_type: str, gap: dict) -> dict:
    """Keep only the fields the export needs, so the persisted blob stays small."""
    if media_type == 'tv':
        return {
            'tvdbId': gap.get('tvdbId'),
            'name': gap.get('name', ''),
            'year': gap.get('year', ''),
            'franchiseName': gap.get('franchiseName', ''),
            'owned': bool(gap.get('owned', False)),
        }
    return {
        'tmdbId': gap.get('tmdbId'),
        'name': gap.get('name', ''),
        'year': gap.get('year', ''),
        'collectionName': gap.get('collectionName', ''),
        'owned': bool(gap.get('owned', False)),
    }


def record(
    media_type: str,
    libraries: list[str],
    total_owned: int,
    missing: int,
    status: str = 'success',
    trigger: str = 'manual',
    message: str = '',
    completed_at: str | None = None,
    gaps: list[dict] | None = None,
) -> None:
    """Append a scan record to the persistent history (capped at MAX_HISTORY).

    When a gap list is provided it's reduced to actionable gaps (see
    `actionable_missing`) and the missing count is derived from it, so every
    recorded scan — manual or scheduled — reports the same figure the user
    sees on the dashboard.
    """
    mt = 'tv' if media_type == 'tv' else 'movie'
    if gaps is not None:
        gaps = actionable_missing(mt, gaps)
        missing = len(gaps)
    entry = {
        'id': uuid.uuid4().hex,
        'timestamp': completed_at or datetime.now(timezone.utc).isoformat(),
        'mediaType': mt,
        'libraries': list(libraries or []),
        'totalOwned': int(total_owned or 0),
        'missing': int(missing or 0),
        'status': status,
        'trigger': trigger,  # 'manual' | 'scheduled'
        'message': message,
        'gaps': [_strip_gap(mt, g) for g in (gaps or [])],
    }
    try:
        with _RECORD_LOCK:
            history = _load_raw()
            history.insert(0, entry)
            del history[MAX_HISTORY:]
            config_store.put(HISTORY_KEY, history)
    except OSError as e:
        logger.warning("Failed to persist scan history: %s", e)


def _load_raw() -> list[dict]:
    raw = config_store.get(HISTORY_KEY)
    return list(raw) if isinstance(raw, list) else []


def _summary(entry: dict) -> dict:
    """Strip the gap list for list responses, exposing hasGaps as a flag."""
    summary = {k: v for k, v in entry.items() if k != 'gaps'}
    summary['hasGaps'] = bool(entry.get('gaps'))
    return summary


def load(
    media_type: str | None = None,
    limit: int | None = None,
    include_gaps: bool = False,
) -> list[dict]:
    """Return scan history, newest first, optionally filtered by media type.

    Gaps are stripped by default so the list endpoint stays small; pass
    include_gaps=True when callers actually need them.
    """
    history = _load_raw()
    if media_type in ('movie', 'tv'):
        history = [e for e in history if e.get('mediaType') == media_type]
    if isinstance(limit, int) and limit > 0:
        history = history[:limit]
    if not include_gaps:
        history = [_summary(e) for e in history]
    return history


def latest(media_type: str) -> dict | None:
    """Return the newest entry summary for the given media type."""
    for entry in _load_raw():
        if entry.get('mediaType') == media_type:
            return _summary(entry)
    return None


def get_by_id(entry_id: str) -> dict | None:
    """Return a single entry (with gaps) by its id, or None."""
    for entry in _load_raw():
        if entry.get('id') == entry_id:
            return entry
    return None
