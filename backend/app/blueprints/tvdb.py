import logging
from flask import Blueprint, jsonify, request, current_app
from app.services import config_store

logger = logging.getLogger(__name__)

tvdb_bp = Blueprint('tvdb', __name__)

_MASK = '••••••'


def _get_service(source: str):
    """Get the appropriate media server service."""
    if source == 'jellyfin':
        return current_app.jellyfin_service
    if source == 'emby':
        return current_app.emby_service
    return current_app.plex_service


def _stored_secret(field: str) -> str:
    return (config_store.get('tvdb', {}) or {}).get(field, '')


@tvdb_bp.route('/config', methods=['GET'])
def get_config():
    cfg = current_app.tvdb_service.get_config()
    # Reveal the real secrets only when the UI explicitly asks (via the Show
    # button); otherwise echo masked placeholders so casual reads don't leak them.
    reveal = request.args.get('reveal', 'false').lower() == 'true'
    if not reveal:
        cfg['api_key'] = _MASK if cfg.get('api_key') else ''
        cfg['pin'] = _MASK if cfg.get('pin') else ''
    return jsonify(cfg)


@tvdb_bp.route('/config', methods=['POST'])
def save_config():
    data = request.get_json() or {}
    # Masked placeholder means "keep the stored value" so users can save other
    # fields without re-typing their key/PIN.
    for field in ('api_key', 'pin'):
        val = data.get(field, '')
        if val and set(val) == {'•'}:
            data[field] = _stored_secret(field)
    saved = current_app.tvdb_service.save_config(data)
    saved['api_key'] = _MASK if saved.get('api_key') else ''
    saved['pin'] = _MASK if saved.get('pin') else ''
    return jsonify(saved)


@tvdb_bp.route('/config', methods=['DELETE'])
def clear_config():
    current_app.tvdb_service.clear_config()
    return jsonify(message='TheTVDB config cleared')


@tvdb_bp.route('/test', methods=['POST'])
def test_connection():
    data = request.get_json() or {}
    api_key = data.get('api_key', '')
    pin = data.get('pin', '')
    if api_key and set(api_key) == {'•'}:
        api_key = _stored_secret('api_key')
    if pin and set(pin) == {'•'}:
        pin = _stored_secret('pin')

    ok, msg = current_app.tvdb_service.test_connection(api_key, pin)
    if ok:
        return jsonify(message=msg)
    return jsonify(error=msg), 400


@tvdb_bp.route('/show', methods=['GET'])
def get_gaps_for_show():
    """Find franchise gaps for a single show (click-through lookup)."""
    series_id = request.args.get('tvdbId', type=int)
    library_name = request.args.get('libraryName', default='', type=str)
    library_names = request.args.getlist('libraryNames')
    source = request.args.get('source', default='plex', type=str)
    show_existing = request.args.get('showExisting', 'false').lower() == 'true'

    if not series_id:
        return jsonify(error='tvdbId is required'), 400
    if not current_app.tvdb_service.is_configured:
        return jsonify(error='No TheTVDB API key configured'), 400

    service = _get_service(source)
    names = library_names if library_names else ([library_name] if library_name else [])
    owned_ids: set[int] = set()
    for name in names:
        owned_ids.update(service.shows_cache.get(name, {}).get('tvdbIds', []))

    gaps, error = current_app.tvdb_service.find_gaps_for_show(series_id, owned_ids, show_existing)
    if error:
        return jsonify(error=error), 500
    return jsonify(gaps=gaps)


@tvdb_bp.route('/scan', methods=['POST'])
def scan_tv_gaps():
    """Start a TV franchise gap scan in the background."""
    data = request.get_json() or {}
    library_name = data.get('libraryName', '')
    library_names = data.get('libraryNames', [])
    source = data.get('source', 'plex')
    show_existing = data.get('showExisting', False)
    fresh_scan = data.get('freshScan', False)

    names = library_names if library_names else ([library_name] if library_name else [])
    if not names:
        return jsonify(error='libraryName or libraryNames is required'), 400

    tvdb = current_app.tvdb_service
    if not tvdb.is_configured:
        return jsonify(error='No TheTVDB API key configured'), 400

    if tvdb.scan_progress.get('status') == 'scanning':
        return jsonify(error='A scan is already in progress'), 409

    service = _get_service(source)

    if fresh_scan:
        tvdb.clear_cache()
        service.clear_shows_cache()
    # Ensure show data is loaded for each selected library.
    for name in names:
        if name not in service.shows_cache:
            service.get_shows(name)

    cache = service.shows_cache
    owned_shows: list[dict] = []
    owned_ids: set[int] = set()
    seen: set[int] = set()
    for name in names:
        data_for_lib = cache.get(name, {})
        for show in data_for_lib.get('shows', []):
            sid = show.get('tvdbId')
            if isinstance(sid, int) and sid not in seen:
                seen.add(sid)
                owned_shows.append(show)
        owned_ids.update(data_for_lib.get('tvdbIds', []))

    if not owned_ids:
        return jsonify(
            error='No TV shows with TheTVDB IDs found in the selected libraries. '
                  'Browse the libraries first to load show data.'
        ), 400

    tvdb.start_scan(
        owned_shows=owned_shows,
        owned_series_ids=owned_ids,
        show_existing=show_existing,
        library_names=names,
    )
    return jsonify(status='started', total_owned=len(owned_ids))


@tvdb_bp.route('/scan/progress', methods=['GET'])
def scan_progress():
    return jsonify(current_app.tvdb_service.scan_progress)


@tvdb_bp.route('/scan/cancel', methods=['POST'])
def cancel_scan():
    cancelled = current_app.tvdb_service.cancel_scan()
    return jsonify(cancelled=cancelled)


@tvdb_bp.route('/ignored', methods=['GET'])
def get_ignored():
    """Return the list of ignored TheTVDB series IDs."""
    return jsonify(ignored=config_store.get('ignored_shows', []))


@tvdb_bp.route('/ignored', methods=['POST'])
def add_ignored():
    """Add one or more shows to the ignored list."""
    data = request.get_json() or {}
    tvdb_id = data.get('tvdbId')
    tvdb_ids = data.get('tvdbIds', [])
    if not tvdb_id and not tvdb_ids:
        return jsonify(error='tvdbId or tvdbIds is required'), 400
    ignored = config_store.get('ignored_shows', [])
    ids_to_add = tvdb_ids if tvdb_ids else [tvdb_id]
    changed = False
    for tid in ids_to_add:
        if tid not in ignored:
            ignored.append(tid)
            changed = True
    if changed:
        config_store.put('ignored_shows', ignored)
    return jsonify(result='ok')


@tvdb_bp.route('/ignored', methods=['DELETE'])
def remove_ignored():
    """Remove one or more shows from the ignored list."""
    data = request.get_json() or {}
    tvdb_id = data.get('tvdbId')
    tvdb_ids = data.get('tvdbIds', [])
    if not tvdb_id and not tvdb_ids:
        return jsonify(error='tvdbId or tvdbIds is required'), 400
    ignored = config_store.get('ignored_shows', [])
    ids_to_remove = set(tvdb_ids if tvdb_ids else [tvdb_id])
    new_ignored = [i for i in ignored if i not in ids_to_remove]
    if len(new_ignored) != len(ignored):
        config_store.put('ignored_shows', new_ignored)
    return jsonify(result='ok')
