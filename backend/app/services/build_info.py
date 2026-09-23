import os
from pathlib import Path
import subprocess

VERSION = '2.12.0'


def _git(*args):
    try:
        result = subprocess.run(
            ['git', *args], cwd=Path(__file__).resolve().parents[3],
            capture_output=True, text=True, timeout=2,
        )
        return result.stdout.strip() if result.returncode == 0 else ''
    except (OSError, subprocess.TimeoutExpired):
        return ''


def get_build_info():
    docker = os.environ.get('APP_INSTALL_TYPE') == 'docker' or Path('/.dockerenv').exists()
    branch = '' if docker else _git('branch', '--show-current')
    return {
        'version': os.environ.get('APP_VERSION', '').removeprefix('v') or VERSION,
        'commit': os.environ.get('APP_COMMIT', '').strip() or _git('rev-parse', 'HEAD') or 'dev',
        'installType': 'docker' if docker else 'source',
        'buildSource': os.environ.get('APP_BUILD_SOURCE', 'local'),
        'channel': os.environ.get('APP_CHANNEL') or ('develop' if branch == 'develop' else 'custom'),
        'branch': branch,
    }
