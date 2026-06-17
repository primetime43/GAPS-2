from flask import Blueprint, jsonify, request, current_app
from app.services import config_store

imdb_bp = Blueprint('imdb', __name__)


@imdb_bp.route('/config', methods=['GET'])
def get_config():
    return jsonify(current_app.imdb_service.get_config())


@imdb_bp.route('/config', methods=['POST'])
def save_config():
    data = request.get_json() or {}
    return jsonify(current_app.imdb_service.save_config(data))


@imdb_bp.route('/status', methods=['GET'])
def status():
    return jsonify(current_app.imdb_service.status())


@imdb_bp.route('/refresh', methods=['POST'])
def refresh():
    started = current_app.imdb_service.refresh_async()
    return jsonify(started=started, **current_app.imdb_service.status())


@imdb_bp.route('/ratings', methods=['POST'])
def ratings():
    """Map a list of TMDB movie ids to their IMDb ratings.

    Movie cards key on TMDB ids, but IMDb data is keyed by IMDb id, so we
    resolve TMDB -> IMDb via TMDB's external_ids (cached, run concurrently)
    and then batch-fetch ratings from imdbapi.dev. Returns
    {ratings: {tmdbId: {imdbId, aggregateRating, voteCount}}}.
    """
    if not config_store.get('preferences', {}).get('showImdbRatings', False):
        return jsonify(ratings={})
    imdb_service = current_app.imdb_service

    raw_ids = (request.get_json() or {}).get('tmdbIds') or []
    tmdb_ids = []
    for value in raw_ids:
        try:
            tmdb_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    tmdb_ids = list(dict.fromkeys(tmdb_ids))
    if not tmdb_ids:
        return jsonify(ratings={})

    tmdb_service = current_app.tmdb_service
    # Resolve TMDB->IMDb concurrently and persist newly-resolved ids (batch helper
    # owns the concurrency cap + persist so it's not duplicated per blueprint).
    imdb_ids = tmdb_service.get_imdb_ids(tmdb_ids)

    # Map each TMDB id to its resolved IMDb id, dropping the unresolved ones.
    tmdb_to_imdb = {t: i for t, i in zip(tmdb_ids, imdb_ids) if i}
    rating_by_imdb = imdb_service.get_ratings(list(tmdb_to_imdb.values()))

    out = {}
    for tmdb_id, imdb_id in tmdb_to_imdb.items():
        rating = rating_by_imdb.get(imdb_id)
        if rating:
            out[str(tmdb_id)] = {
                'imdbId': imdb_id,
                'aggregateRating': rating['aggregateRating'],
                'voteCount': rating['voteCount'],
            }
    return jsonify(ratings=out)
