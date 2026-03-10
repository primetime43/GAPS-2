# GAPS 2

GAPS 2 is a rewrite of the original [GAPS](https://github.com/JasonHHouse/gaps) project. GAPS (Gaps A Plex Server) finds movies you're missing in your Plex Server based on movie collections from The Movie Database (TMDB).

For example, if you own *Alien (1979)*, GAPS will recommend *Aliens (1986)* and *Alien³ (1992)* to complete the collection.

## Features

- Plex OAuth authentication — connect to your Plex account securely
- Browse Plex libraries and view your movie collection
- Find missing movies based on TMDB collections and recommendations
- TMDB API key validation and management
- Responsive dark-themed UI built with Angular 19 and Bootstrap 5
- Dockerized deployment with multi-stage build
- Jellyfin and Emby support planned for future releases

## Project Structure

```
GAPS-2/
├── backend/              # Python Flask API
│   ├── app/
│   │   ├── blueprints/   # Route handlers (plex, tmdb, libraries, recommendations)
│   │   ├── models/       # Data classes (PlexAccount, Movie)
│   │   ├── services/     # Business logic (PlexService, TmdbService)
│   │   └── config.py     # App configuration
│   ├── run.py            # Development entry point
│   ├── wsgi.py           # Production WSGI entry point
│   └── requirements.txt
├── frontend/             # Angular 19 SPA
│   ├── src/app/
│   │   ├── components/   # UI components
│   │   ├── models/       # TypeScript interfaces
│   │   └── services/     # HTTP services
│   ├── proxy.conf.json   # Dev proxy config
│   └── package.json
├── docker/               # Docker deployment
│   ├── Dockerfile
│   └── docker-compose.yml
├── run-dev.bat           # Windows dev launcher (double-click)
└── run-dev.sh            # Bash dev launcher (Linux/Mac/Git Bash)
```

## Quick Start

### One-command launch

**Windows:** Double-click `run-dev.bat`

**Bash (Linux/Mac/Git Bash):**
```bash
./run-dev.sh
```

This automatically sets up a Python virtual environment, installs all dependencies, and starts both servers.

### Manual Setup

#### Prerequisites

- Python 3.9+
- Node.js 18+
- A [TMDB API key](https://www.themoviedb.org/settings/api)
- A Plex account with at least one server

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Linux/Mac
# venv\Scripts\activate.bat     # Windows
pip install -r requirements.txt
python run.py
```

The API server starts at `http://localhost:5000`.

#### Frontend

```bash
cd frontend
npm install
npm start
```

The Angular dev server starts at `http://localhost:4200` and proxies API requests to the backend.

### Docker

Build and run with Docker Compose:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Or build the image directly:

```bash
docker build -f docker/Dockerfile -t gaps-2 .
docker run -p 5000:5000 gaps-2
```

The app will be available at `http://localhost:5000`.

## Usage

1. Go to **Settings > TMDB** and enter your TMDB API key
2. Go to **Settings > Plex** and authenticate your Plex account
3. Fetch servers, select one, and set it as active
4. Go to **Libraries** to browse your movie collection
5. Go to **Missing** to find recommended movies you don't have

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Angular 19, TypeScript 5.8, Bootstrap 5, RxJS |
| Backend | Python, Flask, PlexAPI |
| API | TMDB (The Movie Database) |
| Deployment | Docker (multi-stage build) |

## Development

GAPS 2 is developed by [primetime43](https://github.com/primetime43). Contributions are welcome! Feel free to report bugs, suggest features, or contribute to the code.

## License

See [LICENSE](LICENSE) for details.
