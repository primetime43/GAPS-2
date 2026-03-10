from flask import Blueprint, jsonify, request, current_app

recommendations_bp = Blueprint('recommendations', __name__)

_cached_recommendations: list[dict] = []


@recommendations_bp.route('/', methods=['GET'])
def get_recommendations():
    global _cached_recommendations

    movie_id = request.args.get('movieId', default=11, type=int)
    api_key = request.args.get('apiKey', default='', type=str)
    library_name = request.args.get('libraryName', default='', type=str)
    show_existing = request.args.get('showExisting', 'false').lower() == 'true'

    recommendations, error = current_app.tmdb_service.get_recommendations(
        movie_id=movie_id,
        api_key=api_key,
        library_name=library_name,
        show_existing=show_existing,
        movies_cache=current_app.plex_service.movies_cache,
    )

    if error:
        return jsonify({'message': error}), 500

    _cached_recommendations = recommendations
    return jsonify(recommendations)


@recommendations_bp.route('/cached', methods=['GET'])
def get_cached():
    return jsonify(_cached_recommendations)
