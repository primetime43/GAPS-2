# GAPS 2

GAPS 2 is a rewrite of the original [GAPS](https://github.com/JasonHHouse/gaps) project. GAPS (Gaps A Plex Server) finds movies you're missing in your media server based on movie collections from The Movie Database (TMDB).

For example, if you own *Alien (1979)*, GAPS will recommend *Aliens (1986)* and *Alien³ (1992)* to complete the collection.

## Features

- **Multi-server support** — Plex (OAuth), Jellyfin, and Emby
- Browse libraries and view your movie collection
- Find missing movies based on TMDB collections and recommendations
- Scheduled automatic scanning of libraries
- Notifications via Discord, Telegram, and Email
- User preferences (default library, movies per page, language, hide owned movies, etc.)
- Responsive dark-themed UI built with Angular 19 and Bootstrap 5
- Dockerized deployment with persistent configuration
- Windows standalone executable (single .exe via PyInstaller)
- Automated releases via GitHub Actions (Windows exe + Docker Hub)

## Quick Start

### Windows Executable

Download `GAPS-2.exe` from the [latest release](https://github.com/primetime43/GAPS-2/releases) and run it. The app opens in your browser at `http://localhost:5000`.

### Docker

Pull from [Docker Hub](https://hub.docker.com/r/primetime43/gaps-2):

```bash
docker run -d -p 5000:5000 -v gaps2-data:/app/data primetime43/gaps-2:latest
```

Or use Docker Compose:

```bash
docker compose -f docker/docker-compose.yml up -d
```

The app will be available at `http://localhost:5000`.

### Development

**One-command launch:**

- **Windows:** Double-click `run-dev.bat`
- **Linux/Mac/Git Bash:** `./run-dev.sh`

This automatically sets up a Python virtual environment, installs all dependencies, and starts both servers.

**Manual setup:**

Prerequisites: Python 3.9+, Node.js 20+, a [TMDB API key](https://www.themoviedb.org/settings/api)

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

The Angular dev server starts at `http://localhost:4200` and proxies API requests to the Flask backend at `http://localhost:5000`.

## Usage

1. Go to **Settings > TMDB** and enter your TMDB API key
2. Go to **Settings > Plex/Jellyfin/Emby** and connect your media server
3. Go to **Recommended** to browse your libraries and find missing movies
4. Optionally configure **scheduled scans** and **notifications** in Settings

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
