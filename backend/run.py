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
    port = prefs.get('port', 5000)
    auto_open = prefs.get('autoOpenBrowser', True)

    if auto_open and is_production:
        webbrowser.open(f'http://localhost:{port}')

    app.run(host='0.0.0.0', port=port, debug=not is_production)
