import logging
import os
import sys
from flask import Flask, send_from_directory
from flask_cors import CORS


def _get_bundle_dir():
    """Return the temp extraction dir when running as a PyInstaller bundle."""
    if getattr(sys, 'frozen', False):
        return sys._MEIPASS
    return None


def create_app(config_name=None):
    app = Flask(__name__, static_folder=None)

    if config_name == 'production':
        app.config.from_object('app.config.ProductionConfig')
    else:
        app.config.from_object('app.config.DevelopmentConfig')

    CORS(app)

    # Set up buffered log handler so the UI can display logs
    from app.services.log_handler import log_handler
    log_handler.setFormatter(logging.Formatter('%(name)s - %(message)s'))
    root_logger = logging.getLogger()
    root_logger.addHandler(log_handler)
    root_logger.setLevel(logging.DEBUG)

    # Initialize services and store on app
    from app.services.plex_service import PlexService
    from app.services.tmdb_service import TmdbService
    from app.services.jellyfin_service import JellyfinService
    from app.services.emby_service import EmbyService
    from app.services.schedule_service import ScheduleService
    from app.services.notification_service import NotificationService

    app.plex_service = PlexService()
    app.jellyfin_service = JellyfinService()
    app.emby_service = EmbyService()
    app.tmdb_service = TmdbService(app.config['TMDB_BASE_URL'], app.config['TMDB_IMAGE_BASE_URL'])
    app.notification_service = NotificationService()
    app.schedule_service = ScheduleService()
    app.schedule_service.init_app(app)

    # Register blueprints under /api prefix
    from app.blueprints.plex import plex_bp
    from app.blueprints.tmdb import tmdb_bp
    from app.blueprints.libraries import libraries_bp
    from app.blueprints.recommendations import recommendations_bp
    from app.blueprints.schedule import schedule_bp
    from app.blueprints.notifications import notifications_bp
    from app.blueprints.preferences import preferences_bp
    from app.blueprints.jellyfin import jellyfin_bp
    from app.blueprints.emby import emby_bp
    from app.blueprints.logs import logs_bp
    from app.blueprints.about import about_bp

    app.register_blueprint(plex_bp, url_prefix='/api/plex')
    app.register_blueprint(jellyfin_bp, url_prefix='/api/jellyfin')
    app.register_blueprint(emby_bp, url_prefix='/api/emby')
    app.register_blueprint(tmdb_bp, url_prefix='/api/tmdb')
    app.register_blueprint(libraries_bp, url_prefix='/api/libraries')
    app.register_blueprint(recommendations_bp, url_prefix='/api/recommendations')
    app.register_blueprint(schedule_bp, url_prefix='/api/schedule')
    app.register_blueprint(notifications_bp, url_prefix='/api/notifications')
    app.register_blueprint(preferences_bp, url_prefix='/api/preferences')
    app.register_blueprint(logs_bp, url_prefix='/api/logs')
    app.register_blueprint(about_bp, url_prefix='/api/about')

    # In production, serve Angular dist
    bundle_dir = _get_bundle_dir()
    if bundle_dir:
        dist_dir = os.path.join(bundle_dir, 'frontend', 'dist', 'gaps-2')
    else:
        dist_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend', 'dist', 'gaps-2')
    if os.path.isdir(dist_dir):
        @app.route('/', defaults={'path': ''})
        @app.route('/<path:path>')
        def serve_frontend(path):
            file_path = os.path.join(dist_dir, path)
            if path and os.path.isfile(file_path):
                return send_from_directory(dist_dir, path)
            return send_from_directory(dist_dir, 'index.html')

    return app
