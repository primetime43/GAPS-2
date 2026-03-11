from flask import Blueprint, jsonify, request, current_app

tmdb_bp = Blueprint('tmdb', __name__)


@tmdb_bp.route('/status', methods=['GET'])
def get_status():
    """Return whether a TMDB API key is configured and the key itself."""
    api_key = current_app.tmdb_service.api_key or ''
    return jsonify(hasKey=bool(api_key), apiKey=api_key)


@tmdb_bp.route('/test-key', methods=['POST'])
def test_key():
    api_key = (request.get_json() or {}).get('api_key')
    valid, status_code = current_app.tmdb_service.test_api_key(api_key)
    msgs = current_app.config['RESPONSE_MESSAGES']

    if valid:
        return jsonify({'message': msgs['api_key_success']})
    return jsonify({'message': msgs['api_key_failure'] + str(status_code)}), status_code


@tmdb_bp.route('/save-key', methods=['POST'])
def save_key():
    data = request.get_json() or {}
    api_key = data.get('key')
    valid, status_code = current_app.tmdb_service.save_api_key(api_key)
    msgs = current_app.config['RESPONSE_MESSAGES']

    if valid:
        return jsonify({'message': msgs['api_key_saved']})
    return jsonify({'message': msgs['api_key_failure'] + str(status_code)}), status_code
