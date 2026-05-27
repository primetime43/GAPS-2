"""Unified scan history shared by manual and scheduled scans, movies and TV.

Each completed scan appends a single entry so the dashboard can render a
"recent scans" list across both media types and the scan-history page can
export the gaps that were found.
"""

import logging
import uuid
from datetime import datetime, timezone

from app.services import config_store

logger = logging.getLogger(__name__)

HISTORY_KEY = 'scan_history'
MAX_HISTORY = 50


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
    """Append a scan record to the persistent history (capped at MAX_HISTORY)."""
    mt = 'tv' if media_type == 'tv' else 'movie'
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
