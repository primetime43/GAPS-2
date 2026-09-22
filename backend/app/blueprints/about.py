from flask import Blueprint, jsonify
from app.blueprints.updates import running_build, updater_status

about_bp = Blueprint('about', __name__)


@about_bp.route('', methods=['GET'])
def get_about():
    return jsonify(running_build(updater_status()))
