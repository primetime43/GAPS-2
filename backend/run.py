import os
from app import create_app

is_production = os.environ.get('FLASK_ENV') == 'production'
config = 'production' if is_production else None
app = create_app(config)

if __name__ == '__main__':
    # threaded=True so the dev server handles the SPA's concurrent /api calls on
    # separate connections instead of serializing them on one (single-threaded
    # werkzeug resets overlapping connections, surfacing as proxy ECONNRESETs).
    # Dev-only — production serves via gunicorn (run:app).
    app.run(host='0.0.0.0', port=4277, debug=not is_production, threaded=True)
