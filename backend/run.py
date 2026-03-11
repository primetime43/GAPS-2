import os
from app import create_app

config = 'production' if os.environ.get('FLASK_ENV') == 'production' else None
app = create_app(config)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
