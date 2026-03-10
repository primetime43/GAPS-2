from flask import Blueprint, jsonify, request, current_app

libraries_bp = Blueprint('libraries', __name__)


@libraries_bp.route('/movies', methods=['GET'])
def get_movies():
    library_name = request.args.get('library_name')
    if not library_name:
        return jsonify(error='library_name parameter is required'), 400

    movies, error = current_app.plex_service.get_movies(library_name)
    if error:
        return jsonify(error=error)
    return jsonify(movies=movies)
