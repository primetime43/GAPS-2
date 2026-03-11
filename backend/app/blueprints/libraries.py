from flask import Blueprint, jsonify, request, current_app

libraries_bp = Blueprint('libraries', __name__)


def _get_service(source: str):
    """Get the media server service by source name."""
    if source == 'jellyfin':
        return current_app.jellyfin_service
    elif source == 'emby':
        return current_app.emby_service
    else:
        return current_app.plex_service


@libraries_bp.route('/movies', methods=['GET'])
def get_movies():
    library_name = request.args.get('library_name')
    source = request.args.get('source', 'plex')

    if not library_name:
        return jsonify(error='library_name parameter is required'), 400

    service = _get_service(source)
    movies, error = service.get_movies(library_name)
    if error:
        return jsonify(error=error)
    return jsonify(movies=movies)
