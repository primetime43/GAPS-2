from flask import Blueprint, jsonify, request, current_app

schedule_bp = Blueprint('schedule', __name__)


@schedule_bp.route('', methods=['GET'])
def get_schedule():
    return jsonify(current_app.schedule_service.get_schedule())


@schedule_bp.route('', methods=['POST'])
def set_schedule():
    data = request.get_json() or {}
    preset = data.get('preset', '')
    library = data.get('library', '')
    source = data.get('source', 'plex')

    if not preset or not library:
        return jsonify(error='preset and library are required'), 400

    success = current_app.schedule_service.set_schedule(preset, library, source)
    if not success:
        return jsonify(error='Invalid preset'), 400

    return jsonify(current_app.schedule_service.get_schedule())


@schedule_bp.route('', methods=['DELETE'])
def disable_schedule():
    current_app.schedule_service.disable_schedule()
    return jsonify(current_app.schedule_service.get_schedule())
