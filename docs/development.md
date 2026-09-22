# Development

## One-command launch

- **Windows:** Double-click `run-dev.bat`
- **Linux/Mac/Git Bash:** `./run-dev.sh`

This automatically sets up a Python virtual environment, installs all dependencies, and starts both servers.

## Manual setup

Prerequisites: Python 3.11+, Node.js 20+, a [TMDB API key](https://www.themoviedb.org/settings/api) (for movies), and optionally a free [TheTVDB v4 API key](https://thetvdb.com/dashboard/account/apikey) (for TV franchise scanning)

Open two terminals at the repository root, one for each server.

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate.bat     # Windows
pip install -r requirements.txt
python run.py
```

```bash
# Frontend
cd frontend
npm install
npm start
```

The Angular dev server starts at `http://localhost:4200` and proxies API requests to the Flask backend at `http://localhost:4277`.

[Back to the README](../README.md)
