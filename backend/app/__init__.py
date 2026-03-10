import os
from flask import Flask, send_from_directory
from flask_cors import CORS


def create_app(config_name=None):
    app = Flask(__name__, static_folder=None)

    if config_name == 'production':
        app.config.from_object('app.config.ProductionConfig')
    else:
        app.config.from_object('app.config.DevelopmentConfig')

    CORS(app)

    # Initialize services and store on app
    from app.services.plex_service import PlexService
    from app.services.tmdb_service import TmdbService

    app.plex_service = PlexService()
    app.tmdb_service = TmdbService(app.config['TMDB_BASE_URL'], app.config['TMDB_IMAGE_BASE_URL'])

    # Register blueprints under /api prefix
    from app.blueprints.plex import plex_bp
    from app.blueprints.tmdb import tmdb_bp
    from app.blueprints.libraries import libraries_bp
    from app.blueprints.recommendations import recommendations_bp

    app.register_blueprint(plex_bp, url_prefix='/api/plex')
    app.register_blueprint(tmdb_bp, url_prefix='/api/tmdb')
    app.register_blueprint(libraries_bp, url_prefix='/api/libraries')
    app.register_blueprint(recommendations_bp, url_prefix='/api/recommendations')

    # In production, serve Angular dist
    dist_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', 'frontend', 'dist', 'gaps-2')
    if os.path.isdir(dist_dir):
        @app.route('/', defaults={'path': ''})
        @app.route('/<path:path>')
        def serve_frontend(path):
            file_path = os.path.join(dist_dir, path)
            if path and os.path.isfile(file_path):
                return send_from_directory(dist_dir, path)
            return send_from_directory(dist_dir, 'index.html')

    return app
