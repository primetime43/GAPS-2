import os
import re
from pathlib import Path
import threading
import time
import uuid
from urllib.parse import urlsplit

from flask import Blueprint, jsonify, request
import requests

from app.services.build_info import get_build_info
from update_protocol import BUSY_STATES, read_json, selection, write_json

updates_bp = Blueprint('updates', __name__)
_request_lock = threading.Lock()
_develop_lock = threading.Lock()
_develop_cache = None


def updater_status():
    directory = os.environ.get('GAPS_UPDATES_DIR')
    status = {}
    if directory:
        try:
            status = read_json(Path(directory) / 'status.json', {})
        except (OSError, ValueError):
            pass
    available = bool(directory and isinstance(status, dict) and time.time() - status.get('heartbeat', 0) < 45)
    result = dict(status) if isinstance(status, dict) else {}
    result['available'] = available
    result['reason'] = '' if available else (
        'The Docker updater is not connected. Follow the one-time setup in the release switching guide.'
        if get_build_info()['installType'] == 'docker' else
        'This is a source checkout. In-app switching is available with the optional Docker updater.'
    )
    # Helpers are upgraded separately from the app. Reword historical success
    # messages from older helpers too; their heartbeat is not an update check.
    if result.get('state') == 'done':
        legacy_messages = {
            'Updated to the latest Develop build.': 'Last update installed the Develop image available from the registry at that time.',
            'Develop is already up to date.': 'At the last check, the running Develop image matched the registry image.',
            'The selected build is running.': 'Last update completed: the selected build started successfully.',
        }
        result['message'] = legacy_messages.get(result.get('message'), result.get('message'))
    return result


def running_build(status):
    build = get_build_info()
    if status['available']:
        image = status.get('currentImage', '')
        build['image'] = image
        build['registry'] = ('GitHub Container Registry' if image.startswith('ghcr.io/') else
                             'Docker Hub' if image.startswith('primetime43/') else 'Custom image')
    return build


@updates_bp.get('')
def get_updates():
    status = updater_status()
    return jsonify(build=running_build(status), updater=status)


@updates_bp.get('/releases')
def get_releases():
    try:
        response = requests.get(
            'https://api.github.com/repos/primetime43/GAPS-2/releases',
            params={'per_page': 100}, headers={'Accept': 'application/vnd.github+json'}, timeout=15,
        )
        response.raise_for_status()
        versions = []
        releases = response.json()
        if not isinstance(releases, list):
            raise ValueError('Invalid releases response')
        for release in releases:
            if not isinstance(release, dict):
                continue
            if release.get('draft') or release.get('prerelease'):
                continue
            try:
                versions.append(selection({'channel': 'version', 'version': release['tag_name']})['version'])
            except (KeyError, ValueError):
                continue
        return jsonify(versions=list(dict.fromkeys(versions)))
    except (requests.RequestException, ValueError, TypeError):
        return jsonify(error='Could not load releases from GitHub. You can still enter a version.'), 502


@updates_bp.get('/develop')
def get_develop():
    """Compare against source history separately from a past Docker pull result."""
    global _develop_cache
    with _develop_lock:
        now = time.monotonic()
        if _develop_cache and now < _develop_cache['expires']:
            return jsonify(_develop_cache['body']), _develop_cache['status']
        try:
            response = requests.get(
                'https://api.github.com/repos/primetime43/GAPS-2/commits/develop',
                headers={'Accept': 'application/vnd.github+json'}, timeout=10,
            )
            response.raise_for_status()
            commit = response.json().get('sha')
            if not isinstance(commit, str) or not re.fullmatch(r'[a-f0-9]{40}', commit):
                raise ValueError('Invalid Develop commit')
            body, status = {'commit': commit, 'checkedAt': time.time()}, 200
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            body, status = {'error': 'Could not check the Develop branch on GitHub. Its latest commit is unknown.'}, 502
        # Share checks across tabs/clients, and cache failures to avoid a retry
        # storm when GitHub is unavailable or rate-limited.
        _develop_cache = {'expires': time.monotonic() + 60, 'body': body, 'status': status}
        return jsonify(body), status


@updates_bp.post('/apply')
def apply_update():
    # Do not allow another website to trigger container replacement through CORS.
    origin = request.headers.get('Origin', '').rstrip('/')
    if origin:
        parsed = urlsplit(origin)
        # Match the public host, allowing HTTPS termination at a reverse proxy.
        if parsed.scheme not in ('http', 'https') or parsed.netloc.lower() != request.host.lower():
            return jsonify(error='Updates must be requested from this app.'), 403
    if not request.is_json or request.headers.get('X-GAPS-Update') != '1':
        return jsonify(error='Invalid update request.'), 400
    try:
        choice = selection(request.get_json(silent=True))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    with _request_lock:
        status = updater_status()
        if not status['available']:
            return jsonify(error=status['reason']), 503
        directory = Path(os.environ['GAPS_UPDATES_DIR'])
        if status.get('state') in BUSY_STATES or (directory / 'request.json').exists():
            return jsonify(error='An update is already in progress.'), 409
        job = {'id': uuid.uuid4().hex, 'selection': choice}
        try:
            write_json(directory / 'request.json', job, mode=0o644)
        except OSError:
            return jsonify(error='Could not queue the update. Check updater volume permissions.'), 503
    return jsonify(requestId=job['id'], message='Update queued. The app will restart.'), 202
