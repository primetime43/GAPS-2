from flask import Blueprint, jsonify, request
from app.services.log_handler import log_handler

logs_bp = Blueprint('logs', __name__)


@logs_bp.route('', methods=['GET'])
def get_logs():
    """Return buffered log entries, optionally filtered by level."""
    level = request.args.get('level', None)
    entries = log_handler.get_entries(level)
    return jsonify(entries=entries)


@logs_bp.route('', methods=['DELETE'])
def clear_logs():
    """Clear the in-memory log buffer."""
    log_handler.clear()
    return jsonify(result='Cleared')
