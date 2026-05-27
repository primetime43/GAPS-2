from flask import Blueprint, jsonify, request
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
