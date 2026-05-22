from flask import Blueprint, jsonify, request, current_app

schedule_bp = Blueprint('schedule', __name__)


@schedule_bp.route('', methods=['GET'])
def get_schedule():
    return jsonify(current_app.schedule_service.get_schedule())


@schedule_bp.route('', methods=['POST'])
def set_schedule():
    data = request.get_json() or {}
    media_type = data.get('mediaType', 'movie')
    preset = data.get('preset', '')
    library = data.get('library', '')
    source = data.get('source', 'plex')

    if media_type not in ('movie', 'tv'):
        return jsonify(error='mediaType must be "movie" or "tv"'), 400
    if not preset or not library:
        return jsonify(error='preset and library are required'), 400

    success = current_app.schedule_service.set_schedule(media_type, preset, library, source)
    if not success:
        return jsonify(error='Invalid preset'), 400

    return jsonify(current_app.schedule_service.get_schedule())


@schedule_bp.route('', methods=['DELETE'])
def disable_schedule():
    # Accept mediaType via query (?mediaType=tv) or JSON body; default to movie.
    media_type = request.args.get('mediaType') or (request.get_json(silent=True) or {}).get('mediaType', 'movie')
    if media_type not in ('movie', 'tv'):
        return jsonify(error='mediaType must be "movie" or "tv"'), 400
    current_app.schedule_service.disable_schedule(media_type)
    return jsonify(current_app.schedule_service.get_schedule())
