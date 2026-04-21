import os
import subprocess
from flask import Blueprint, jsonify

about_bp = Blueprint('about', __name__)

VERSION = '2.2.0'


def _get_commit() -> str:
    commit = os.environ.get('APP_COMMIT', '').strip()
    if commit:
        return commit
    try:
        from app import _build_info
        if getattr(_build_info, 'COMMIT', '').strip():
            return _build_info.COMMIT.strip()
    except ImportError:
        pass
    try:
        result = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            cwd=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
            capture_output=True, text=True, timeout=2,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return 'dev'


@about_bp.route('', methods=['GET'])
def get_about():
    return jsonify(version=VERSION, commit=_get_commit())
