from flask import Blueprint, jsonify, request, current_app

notifications_bp = Blueprint('notifications', __name__)


@notifications_bp.route('', methods=['GET'])
def get_config():
    return jsonify(current_app.notification_service.get_config())


@notifications_bp.route('/<service>', methods=['POST'])
def save_config(service):
    if service not in ('discord', 'telegram', 'email'):
        return jsonify(error='Unknown service'), 400

    data = request.get_json() or {}
    current_app.notification_service.save_config(service, data)
    return jsonify(message=f'{service.title()} settings saved')


@notifications_bp.route('/<service>/test', methods=['POST'])
def test_notification(service):
    if service not in ('discord', 'telegram', 'email'):
        return jsonify(error='Unknown service'), 400

    success, msg = current_app.notification_service.test(service)
    if success:
        return jsonify(message='Test notification sent!')
    return jsonify(error=msg), 400
