from flask import Blueprint, jsonify, request, current_app

emby_bp = Blueprint('emby', __name__)


@emby_bp.route('/test', methods=['POST'])
def test_connection():
    data = request.get_json() or {}
    server_url = data.get('serverUrl', '')
    api_key = data.get('apiKey', '')

    if not server_url or not api_key:
        return jsonify(error='Server URL and API key are required'), 400

    ok, server_name = current_app.emby_service.test_connection(server_url, api_key)
    if ok:
        return jsonify(connected=True, serverName=server_name)
    return jsonify(connected=False, error='Could not connect to Emby server')


@emby_bp.route('/connect', methods=['POST'])
def connect():
    data = request.get_json() or {}
    server_url = data.get('serverUrl', '')
    api_key = data.get('apiKey', '')

    if not server_url or not api_key:
        return jsonify(error='Server URL and API key are required'), 400

    ok, server_name, error = current_app.emby_service.connect(server_url, api_key)
    if not ok:
        return jsonify(error=error), 400

    libs, lib_err = current_app.emby_service.fetch_libraries()
    libraries = libs or []

    return jsonify(
        connected=True,
        serverName=server_name,
        libraries=libraries,
    )


@emby_bp.route('/save', methods=['POST'])
def save():
    data = request.get_json() or {}
    server_url = data.get('serverUrl', '')
    api_key = data.get('apiKey', '')
    server_name = data.get('serverName', 'Emby Server')
    libraries = data.get('libraries', [])

    current_app.emby_service.save_active_server(server_url, api_key, server_name, libraries)
    return jsonify(result='Success')


@emby_bp.route('/test-active', methods=['POST'])
def test_active_connection():
    ok, server_name = current_app.emby_service.test_active_connection()
    if ok:
        return jsonify(connected=True, serverName=server_name)
    return jsonify(connected=False, error='Could not reach Emby server')


@emby_bp.route('/refresh', methods=['POST'])
def refresh():
    ok, error, libraries = current_app.emby_service.refresh_connection()
    if ok:
        return jsonify(connected=True, libraries=libraries)
    return jsonify(connected=False, error=error or 'Refresh failed')


@emby_bp.route('/active-server', methods=['GET'])
def get_active_server():
    result = current_app.emby_service.get_active_server()
    if result:
        return jsonify(**result)
    return jsonify(error='No active Emby server'), 404


@emby_bp.route('/active-server', methods=['DELETE'])
def remove_active_server():
    current_app.emby_service.remove_active_server()
    return jsonify(result='Success')
