"""Small file protocol shared by the app and the optional Docker updater."""

import json
import os
from pathlib import Path
import re
import tempfile

REPOSITORIES = ('ghcr.io/primetime43/gaps-2', 'primetime43/gaps-2')
BUSY_STATES = ('queued', 'pulling', 'backing-up', 'restarting', 'checking', 'rolling-back')


def selection(data):
    if not isinstance(data, dict):
        raise ValueError('Choose Stable, Develop, or a specific version.')
    channel = data.get('channel')
    if channel in ('stable', 'develop'):
        return {'channel': channel, 'version': ''}
    version = data.get('version', '')
    if channel == 'version' and isinstance(version, str) and re.fullmatch(r'v?\d+\.\d+\.\d+', version):
        return {'channel': channel, 'version': version.removeprefix('v')}
    raise ValueError('Enter a release version such as 2.11.0.')


def image_for(repository, choice):
    if repository not in REPOSITORIES:
        raise ValueError('Only official GAPS image repositories are supported.')
    choice = selection(choice)
    tag = {'stable': 'latest', 'develop': 'develop'}.get(choice['channel'], choice['version'])
    return f'{repository}:{tag}'


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return default


def write_json(path, value, mode=0o600):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
