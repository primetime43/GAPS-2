import os
import sys
from app import create_app

is_production = os.environ.get('FLASK_ENV') == 'production' or getattr(sys, 'frozen', False)
config = 'production' if is_production else None
app = create_app(config)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=not is_production)
