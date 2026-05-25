# GAPS 2

GAPS 2 is a rewrite of the original [GAPS](https://github.com/JasonHHouse/gaps) project. GAPS (Gaps A Plex Server) finds **movies and TV shows you're missing** in your media server:

- **Movies** — based on movie collections from The Movie Database (TMDB). For example, if you own *Alien (1979)*, GAPS recommends *Aliens (1986)* and *Alien³ (1992)* to complete the collection.
- **TV shows** — based on official franchise lists from [TheTVDB](https://thetvdb.com). For example, if you own *Yellowstone*, GAPS surfaces *1883* and *1923* from the same franchise.

## Features

- **Multi-server support** — Plex (OAuth), Jellyfin, and Emby
- **Unified "Missing" view** with a Movies / TV Shows toggle — browse a library, scan it for gaps, or click a single title to check just its collection/franchise
- **Find missing movies** based on TMDB collections and recommendations
- **Find missing TV shows** based on TheTVDB's official franchise lists
- **Send to Radarr / Sonarr** — add missing movies to Radarr (by TMDB id) and missing shows to Sonarr (by TheTVDB id) directly from the results
- Filter results: show/hide owned, hide future (unreleased) titles, ignore individual titles or whole collections, and export to CSV/Excel
- **Independent scheduled scans** for movies and TV, each with its own cadence
- Notifications via Discord, Telegram, and Email
- User preferences (default library, items per page, language, hide owned, etc.)
- Responsive dark-themed UI built with Angular 19 and Bootstrap 5
- Dockerized deployment with persistent configuration
- Windows standalone executable (single .exe via PyInstaller)
- Automated releases via GitHub Actions (Windows exe + Docker Hub)

## Quick Start

### Windows Executable

Download `GAPS-2.exe` from the [latest release](https://github.com/primetime43/GAPS-2/releases) and run it. The app opens in your browser at `http://localhost:4277`.

### Docker

Pull from [Docker Hub](https://hub.docker.com/r/primetime43/gaps-2):

```bash
docker run -d -p 4277:4277 -v gaps2-data:/app/data primetime43/gaps-2:latest
```

Or use Docker Compose:

```bash
docker compose -f docker/docker-compose.yml up -d
```

The app will be available at `http://localhost:4277`.

**Development builds:** unreleased changes on the `develop` branch are published to Docker Hub on every push. Use these for testing upcoming features — they are not considered stable.

```bash
docker pull primetime43/gaps-2:develop
```

> **Persist `/app/data`.** GAPS encrypts saved settings (API keys, tokens, server URLs) in `backend/data/config.enc`. The encryption key lives next to it as `.config.key`, so both files must be on a persistent volume — otherwise every container recreation generates a fresh key and the old config becomes unreadable. The `docker run` example above and the Compose file already mount `/app/data`; if you write your own command (e.g. an unRAID template), make sure the mount is there. To override the key explicitly — for moving between hosts or sharing a config across replicas — set the `GAPS2_CONFIG_KEY` environment variable to a Fernet key (output of `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).

### Images of v2.1.0
<details>
  <summary>Click to view screenshots of version 2.1.0</summary>
<img width="1670" height="618" alt="image" src="https://github.com/user-attachments/assets/0d17e565-1fe0-4b0d-a297-f389a40eb806" />
<img width="1187" height="263" alt="image" src="https://github.com/user-attachments/assets/ec18a8de-f842-453d-843c-4e6122ab1aab" />
<img width="1529" height="442" alt="image" src="https://github.com/user-attachments/assets/c956ba5e-2268-4710-b71c-d8e1a3e31489" />
<img width="1517" height="628" alt="image" src="https://github.com/user-attachments/assets/ecd2f78c-23e6-4c37-a89c-3d06ad31f276" />
<img width="1535" height="987" alt="image" src="https://github.com/user-attachments/assets/9208cd60-eef1-4458-8df4-5671569b3cf1" />
</details>
  
### Development

**One-command launch:**

- **Windows:** Double-click `run-dev.bat`
- **Linux/Mac/Git Bash:** `./run-dev.sh`

This automatically sets up a Python virtual environment, installs all dependencies, and starts both servers.

**Manual setup:**

Prerequisites: Python 3.9+, Node.js 20+, a [TMDB API key](https://www.themoviedb.org/settings/api) (for movies), and optionally a free [TheTVDB v4 API key](https://thetvdb.com/dashboard/account/apikey) (for TV franchise scanning)

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

## Usage

1. Go to **Settings > TMDB** and enter your TMDB API key (required for movies)
2. *(Optional, for TV)* Go to **Settings > TheTVDB** and enter your free TheTVDB API key
3. Go to **Settings > Plex/Jellyfin/Emby** and connect your media server
4. Go to **Missing**, choose **Movies** or **TV Shows**, pick a library, and click **Scan for Gaps** — or click a single title to check just its collection/franchise
5. *(Optional)* Configure **Radarr** and/or **Sonarr** in Settings to send missing titles straight to your downloaders
6. *(Optional)* Configure **scheduled scans** (separate cadences for movies and TV) and **notifications** in Settings

> **TheTVDB API key:** create a free key on your [TheTVDB dashboard](https://thetvdb.com/dashboard/account/apikey). Some keys are tied to the *User Subscription* funding model and require your subscriber PIN; if so, GAPS will tell you, and you can enter the PIN on the TheTVDB settings page.

## License

This project is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
