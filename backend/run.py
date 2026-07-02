import os
import sys
import webbrowser
from app import create_app
from app.services import config_store

is_production = os.environ.get('FLASK_ENV') == 'production' or getattr(sys, 'frozen', False)
config = 'production' if is_production else None
app = create_app(config)

if __name__ == '__main__':
    prefs = config_store.get('preferences', {})
    port = prefs.get('port', 4277)
    auto_open = prefs.get('autoOpenBrowser', True)

    if auto_open and is_production:
        webbrowser.open(f'http://localhost:{port}')

    # threaded=True so the dev server handles the SPA's concurrent /api calls on
    # separate connections instead of serializing them on one (single-threaded
    # werkzeug resets overlapping connections, surfacing as proxy ECONNRESETs).
    # Dev-only — production serves via gunicorn (wsgi.py).
    app.run(host='0.0.0.0', port=port, debug=not is_production, threaded=True)
