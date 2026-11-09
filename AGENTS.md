# Repository Guidelines

## Project Structure & Module Organization

GAPS 2 is a Flask and Angular application. Backend code lives in `backend/app/`: HTTP routes are grouped under `blueprints/`, integrations and business logic under `services/`, and shared data shapes under `models/`. The Angular 19 client is in `frontend/src/app/`, with page components in `components/`, API clients in `services/`, and shared interfaces in `models/`. Static images and styles belong in `frontend/src/assets/` and `frontend/src/styles.scss`. Deployment files are under `docker/`; release automation is in `.github/workflows/`.

Frontend tests are colocated with source as `*.spec.ts`. Root scripts such as `run-dev.bat`, `run-dev.sh`, and `build-exe.bat` coordinate full-stack development and packaging.

## Build, Test, and Development Commands

- `run-dev.bat` (Windows) or `./run-dev.sh` (Linux/macOS): create the Python environment, install dependencies, and start both servers.
- `cd backend && pip install -r requirements.txt && python run.py`: run Flask on port 4277.
- `cd frontend && npm ci && npm start`: install locked dependencies and run Angular on port 4200 with API proxying.
- `cd frontend && npm run build`: create the production frontend bundle.
- `cd frontend && npm test -- --watch=false --browsers=ChromeHeadless`: run the Angular test suite once.
- `docker compose -f docker/docker-compose.yml up -d`: run the containerized application.

## Coding Style & Naming Conventions

Use four spaces in Python and two spaces in TypeScript, HTML, and SCSS. Follow Python `snake_case` for functions/modules and `PascalCase` for classes. Angular files use kebab-case (`scan-history.component.ts`), classes use `PascalCase`, and properties/methods use `camelCase`. Keep Flask routes thin by placing reusable work in services. No repository-wide formatter or linter is configured, so match surrounding code and run `git diff --check`.

## Testing Guidelines

Angular tests use Jasmine and Karma. Name tests `*.spec.ts`, keep them beside the unit under test, and mock HTTP/integration services. Cover success, cancellation, and error rollback for state-changing UI behavior. There is currently no committed backend test suite or coverage threshold; add focused tests when introducing backend test infrastructure and document the command.

## Commit & Pull Request Guidelines

Recent history uses short, imperative subjects such as `Fix gap hydration...`, `Add ignore confirmation...`, and `Document GHCR...`. Keep each commit focused; reserve version-only subjects for releases. Pull requests should explain behavior changes, link issues (for example, `Closes #59`), list verification commands, and include screenshots for visible UI changes. Call out configuration or persistence changes explicitly.

## Security & Configuration

Never commit API keys, tokens, `backend/data/config.enc`, or `.config.key`. Persist both encrypted configuration files in deployments, and use `GAPS2_CONFIG_KEY` when an explicit shared key is required.
