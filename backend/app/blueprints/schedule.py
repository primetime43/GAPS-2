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
    # Multiple libraries; accept the legacy single `library` field too.
    libraries = data.get('libraries')
    if not isinstance(libraries, list):
        single = data.get('library', '')
        libraries = [single] if single else []
    libraries = [str(x) for x in libraries if x]
    source = data.get('source', 'plex')
    hour = data.get('hour', 4)
    minute = data.get('minute', 0)
    day_of_week = data.get('dayOfWeek', 'mon')

    if media_type not in ('movie', 'tv'):
        return jsonify(error='mediaType must be "movie" or "tv"'), 400
    if not preset or not libraries:
        return jsonify(error='preset and at least one library are required'), 400

    success = current_app.schedule_service.set_schedule(
        media_type, preset, libraries, source, hour, minute, day_of_week,
    )
    if not success:
        return jsonify(error='Invalid preset or time'), 400

    return jsonify(current_app.schedule_service.get_schedule())


@schedule_bp.route('', methods=['DELETE'])
def disable_schedule():
    # Accept mediaType via query (?mediaType=tv) or JSON body; default to movie.
    media_type = request.args.get('mediaType') or (request.get_json(silent=True) or {}).get('mediaType', 'movie')
    if media_type not in ('movie', 'tv'):
        return jsonify(error='mediaType must be "movie" or "tv"'), 400
    current_app.schedule_service.disable_schedule(media_type)
    return jsonify(current_app.schedule_service.get_schedule())
