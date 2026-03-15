from flask import Blueprint, jsonify, request, current_app

plex_bp = Blueprint('plex', __name__)


@plex_bp.route('/authenticate', methods=['POST'])
def authenticate():
    oauth_url = current_app.plex_service.authenticate()
    return jsonify({'oauth_url': oauth_url})


@plex_bp.route('/check-login', methods=['GET'])
def check_login():
    logged_in = current_app.plex_service.check_login()
    return jsonify(authenticated=logged_in)


@plex_bp.route('/connect-manual', methods=['POST'])
def connect_manual():
    data = request.get_json() or {}
    server_url = data.get('serverUrl', '').strip()
    token = data.get('token', '').strip()
    if not server_url or not token:
        return jsonify(connected=False, error='Server URL and token are required.'), 400
    ok, server_name, libraries, error = current_app.plex_service.connect_manual(server_url, token)
    if not ok:
        return jsonify(connected=False, error=error), 400
    return jsonify(connected=True, serverName=server_name, libraries=libraries)


@plex_bp.route('/fetch-servers', methods=['POST'])
def fetch_servers():
    servers, token = current_app.plex_service.fetch_servers()
    if not servers:
        return jsonify({'message': 'User is not authenticated', 'servers': [], 'token': None})
    # Include connection URLs for each server so the UI can show them immediately
    server_connections = {}
    for name in servers:
        server_connections[name] = current_app.plex_service.get_connections(name)
    return jsonify(servers=servers, token=token, serverConnections=server_connections)


@plex_bp.route('/libraries/<path:server_name>', methods=['GET'])
def fetch_libraries(server_name):
    connection_url = request.args.get('connectionUrl', '')
    libraries, token, error = current_app.plex_service.fetch_libraries(server_name, connection_url or None)
    connections = current_app.plex_service.get_connections(server_name)
    if error:
        return jsonify(error=error, connections=connections), 404
    return jsonify(libraries=libraries, token=token, connections=connections)


@plex_bp.route('/save-data', methods=['POST'])
def save_data():
    data = request.get_json() or {}
    server = data.get('server')
    token = data.get('token')
    libraries = data.get('libraries')
    server_url = data.get('serverUrl')

    success, error = current_app.plex_service.save_active_server(server, token, libraries, server_url)
    if success:
        return jsonify(result='Success')
    return jsonify(result='Error', error=error)


@plex_bp.route('/test-active', methods=['POST'])
def test_active_connection():
    ok, server_name = current_app.plex_service.test_active_connection()
    if ok:
        return jsonify(connected=True, serverName=server_name)
    return jsonify(connected=False, error=server_name or 'Connection failed')


@plex_bp.route('/refresh', methods=['POST'])
def refresh_connection():
    ok, error, libraries = current_app.plex_service.refresh_connection()
    if ok:
        return jsonify(connected=True, libraries=libraries)
    return jsonify(connected=False, error=error or 'Refresh failed')


@plex_bp.route('/active-server', methods=['GET'])
def get_active_server():
    try:
        result = current_app.plex_service.get_active_server()
        if result:
            return jsonify(**result)
        return jsonify(error='No active server found')
    except Exception as e:
        return jsonify(error=str(e))


@plex_bp.route('/active-server', methods=['DELETE'])
def remove_active_server():
    current_app.plex_service.remove_active_server()
    return jsonify(result='Success')
