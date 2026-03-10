from flask import Blueprint, jsonify, request, current_app

plex_bp = Blueprint('plex', __name__)


@plex_bp.route('/authenticate', methods=['POST'])
def authenticate():
    oauth_url = current_app.plex_service.authenticate()
    return jsonify({'oauth_url': oauth_url})


@plex_bp.route('/fetch-servers', methods=['POST'])
def fetch_servers():
    servers, token = current_app.plex_service.fetch_servers()
    if not servers:
        return jsonify({'message': 'User is not authenticated', 'servers': [], 'token': None})
    return jsonify(servers=servers, token=token)


@plex_bp.route('/libraries/<path:server_name>', methods=['GET'])
def fetch_libraries(server_name):
    libraries, token, error = current_app.plex_service.fetch_libraries(server_name)
    if error:
        msg = current_app.config['RESPONSE_MESSAGES'].get(
            'plex_data_not_found' if 'not found' in error.lower() else 'server_not_found',
            error,
        )
        return jsonify(error=msg), 404
    return jsonify(libraries=libraries, token=token)


@plex_bp.route('/save-data', methods=['POST'])
def save_data():
    data = request.get_json()
    server = data.get('server')
    token = data.get('token')
    libraries = data.get('libraries')

    success, error = current_app.plex_service.save_active_server(server, token, libraries)
    if success:
        return jsonify(result='Success')
    return jsonify(result='Error', error=error)


@plex_bp.route('/active-server', methods=['GET'])
def get_active_server():
    try:
        result = current_app.plex_service.get_active_server()
        if result:
            return jsonify(**result)
        return jsonify(error='No active server found')
    except Exception as e:
        return jsonify(error=str(e))
