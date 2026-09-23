# GAPS 2 frontend

Run these commands from `frontend/`:

- `npm ci` installs the locked dependencies.
- `npm start` serves the app at `http://localhost:4200` and proxies `/api` to the backend at `http://localhost:4277`.
- `npm run build` writes the production app to `dist/gaps-2/`.
- `npm test` runs the Karma unit tests.
- `npm test -- --watch=false --browsers=ChromeHeadless` runs the tests once. Set `CHROME_BIN` to your Chrome or Edge executable if needed.

TypeScript rejects unused locals, imports, and parameters during builds and tests. Prefix intentionally unused parameters with `_`.

See the [project README](../README.md) for backend setup and packaging.
