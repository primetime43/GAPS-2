from flask import Blueprint, current_app, jsonify, request
from app.services import scan_history

scan_history_bp = Blueprint('scan_history', __name__)


@scan_history_bp.route('', methods=['GET'])
def get_scan_history():
    """Return recent scan history with the latest entry per media type.

    Query params:
      - mediaType: 'movie' | 'tv' (optional filter)
      - limit: int (optional cap on the returned list)

    Gap lists are omitted to keep the payload small; fetch a single entry
    via `/api/scan-history/<id>` to get its gaps for export.
    """
    media_type = request.args.get('mediaType', default=None, type=str)
    if media_type not in ('movie', 'tv'):
        media_type = None
    limit = request.args.get('limit', default=None, type=int)
    history = scan_history.load(media_type=media_type, limit=limit)
    return jsonify(
        history=history,
        lastMovie=scan_history.latest('movie'),
        lastTv=scan_history.latest('tv'),
    )


@scan_history_bp.route('/<entry_id>', methods=['GET'])
def get_scan_entry(entry_id: str):
    """Return a single history entry (including its gaps) by id."""
    entry = scan_history.get_by_id(entry_id)
    if not entry:
        return jsonify(error='Scan history entry not found'), 404
    return jsonify(entry)


@scan_history_bp.route('/<entry_id>/gaps', methods=['GET'])
def get_scan_entry_gaps(entry_id: str):
    """Return a saved scan's gap list rehydrated for the Missing view.

    Display fields are re-attached from the warm TMDB/TheTVDB caches, with
    stored poster URLs surviving cache expiry. Legacy entries missing posters
    recover them from the provider and save them for subsequent visits.
    """
    entry = scan_history.get_by_id(entry_id)
    if not entry:
        return jsonify(error='Scan history entry not found'), 404
    media_type = 'tv' if entry.get('mediaType') == 'tv' else 'movie'
    stored = entry.get('gaps') or []
    service = current_app.tvdb_service if media_type == 'tv' else current_app.tmdb_service
    gaps = service.hydrate_gaps(stored)
    id_key = 'tvdbId' if media_type == 'tv' else 'tmdbId'
    missing_ids = list(dict.fromkeys(
        g[id_key] for g in gaps if 'posterUrl' not in g and g.get(id_key)
    ))
    if missing_ids:
        posters = service.get_history_posters(missing_ids)
        gaps = [
            {**g, 'posterUrl': posters[g[id_key]]} if g.get(id_key) in posters else g
            for g in gaps
        ]
    if any('posterUrl' not in g for g in stored):
        scan_history.save_posters(entry_id, media_type, gaps)
    return jsonify(
        gaps=gaps,
        mediaType=media_type,
        libraries=entry.get('libraries') or [],
        totalOwned=entry.get('totalOwned') or 0,
        timestamp=entry.get('timestamp'),
        rating_filter_complete=bool(entry.get('rating_filter_complete')),
    )
