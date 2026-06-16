import csv
import gzip
import io
import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
import requests
from app.services import config_store

logger = logging.getLogger(__name__)

CONFIG_KEY = 'imdb'
DB_FILE = 'imdb_ratings.db'
DOWNLOAD_TIMEOUT = 120
# Re-download the dataset at most once a day (IMDb refreshes it daily).
REFRESH_TTL_SECONDS = 24 * 60 * 60
# SQLite caps bound parameters per statement (default 999); chunk IN() lookups.
SQL_VAR_LIMIT = 900
INSERT_BATCH = 50_000


class ImdbService:
    """IMDb ratings via IMDb's free official dataset (datasets.imdbws.com).

    The whole `title.ratings` table (~1.5M rows) is downloaded once and stored
    in a local SQLite DB, so per-title lookups are instant, keyless, and free of
    rate limits. The dataset is refreshed in the background at most daily. There
    is no per-request API call — only the one bulk download.
    """

    def __init__(self, default_dataset_url: str):
        self._default_url = (default_dataset_url or '').strip()
        self._db_path = os.path.join(config_store.data_dir(), DB_FILE)
        self._lock = threading.Lock()  # guards build state below
        self._building = False
        self._last_error: str | None = None

    # -- Config --

    def get_config(self) -> dict:
        saved = config_store.get(CONFIG_KEY, {}) or {}
        return {
            'enabled': bool(saved.get('enabled', False)),
            'datasetUrl': saved.get('datasetUrl') or self._default_url,
        }

    def save_config(self, data: dict) -> dict:
        cleaned = {
            'enabled': bool(data.get('enabled', False)),
            'datasetUrl': (data.get('datasetUrl') or '').strip() or self._default_url,
        }
        config_store.put(CONFIG_KEY, cleaned)
        cfg = self.get_config()
        # Enabling for the first time? Start fetching the dataset in the
        # background so ratings are ready shortly after.
        if cfg['enabled']:
            self._maybe_refresh()
        return cfg

    @property
    def enabled(self) -> bool:
        return self.get_config()['enabled']

    def _dataset_url(self) -> str:
        return self.get_config()['datasetUrl']

    # -- Dataset state --

    def _dataset_ready(self) -> bool:
        return os.path.isfile(self._db_path)

    def _dataset_info(self) -> dict:
        """Row count + last-updated date from the local DB's meta row."""
        if not self._dataset_ready():
            return {'ready': False, 'count': 0, 'updatedAt': None, 'age': None}
        try:
            con = sqlite3.connect(self._db_path, timeout=5)
            try:
                row = con.execute('SELECT count, updated_at, built_at FROM meta LIMIT 1').fetchone()
            finally:
                con.close()
        except sqlite3.Error:
            return {'ready': False, 'count': 0, 'updatedAt': None, 'age': None}
        if not row:
            return {'ready': True, 'count': 0, 'updatedAt': None, 'age': None}
        count, updated_at, built_at = row
        age = (time.time() - built_at) if isinstance(built_at, (int, float)) else None
        return {'ready': True, 'count': count, 'updatedAt': updated_at, 'age': age}

    def status(self) -> dict:
        cfg = self.get_config()
        info = self._dataset_info()
        # Opportunistically kick off a refresh if enabled and stale/missing.
        if cfg['enabled']:
            self._maybe_refresh(info)
        with self._lock:
            building = self._building
            error = self._last_error
        return {
            **cfg,
            'ready': info['ready'],
            'titleCount': info['count'],
            'updatedAt': info['updatedAt'],
            'building': building,
            'error': error,
        }

    def _maybe_refresh(self, info: dict | None = None) -> None:
        """Trigger a background download if the dataset is missing or stale."""
        info = info or self._dataset_info()
        stale = info['age'] is None or info['age'] > REFRESH_TTL_SECONDS
        if not info['ready'] or stale:
            self.refresh_async()

    def refresh_async(self) -> bool:
        """Start a background dataset download/build. No-op if already running."""
        with self._lock:
            if self._building:
                return False
            self._building = True
            self._last_error = None
        threading.Thread(target=self._build_safe, daemon=True).start()
        return True

    def _build_safe(self) -> None:
        try:
            self._build_dataset()
        except Exception as e:  # noqa: BLE001 - surface any failure to the UI
            logger.warning("IMDb dataset build failed: %s", e)
            with self._lock:
                self._last_error = str(e)
        finally:
            with self._lock:
                self._building = False

    def _build_dataset(self) -> None:
        url = self._dataset_url()
        logger.info("Downloading IMDb ratings dataset from %s", url)
        resp = requests.get(url, timeout=DOWNLOAD_TIMEOUT)
        resp.raise_for_status()
        raw = resp.content

        con = sqlite3.connect(self._db_path, timeout=30)
        try:
            # WAL lets reads keep serving the old data while we rebuild.
            con.execute('PRAGMA journal_mode=WAL')
            con.execute('CREATE TABLE IF NOT EXISTS ratings (tconst TEXT PRIMARY KEY, rating REAL, votes INTEGER)')
            con.execute('CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), count INTEGER, updated_at TEXT, built_at REAL)')

            count = 0
            con.execute('BEGIN')
            con.execute('DELETE FROM ratings')
            with gzip.open(io.BytesIO(raw), 'rt', encoding='utf-8', newline='') as fh:
                reader = csv.reader(fh, delimiter='\t')
                next(reader, None)  # header: tconst  averageRating  numVotes
                batch = []
                for row in reader:
                    if len(row) < 3:
                        continue
                    try:
                        rec = (row[0], float(row[1]), int(row[2]))
                    except ValueError:
                        continue
                    batch.append(rec)
                    count += 1
                    if len(batch) >= INSERT_BATCH:
                        con.executemany('INSERT OR REPLACE INTO ratings VALUES (?, ?, ?)', batch)
                        batch.clear()
                if batch:
                    con.executemany('INSERT OR REPLACE INTO ratings VALUES (?, ?, ?)', batch)

            updated = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            con.execute(
                'INSERT OR REPLACE INTO meta (id, count, updated_at, built_at) VALUES (1, ?, ?, ?)',
                (count, updated, time.time()),
            )
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
        logger.info("IMDb ratings dataset built: %d titles", count)

    # -- Lookups --

    def get_ratings(self, imdb_ids: list[str]) -> dict[str, dict]:
        """Return {imdb_id: {'aggregateRating', 'voteCount'}} from the local DB.

        Missing/unrated titles are simply absent. If the dataset isn't built yet
        (and the integration is enabled), a background build is kicked off and an
        empty result is returned for now.
        """
        ids = [i for i in dict.fromkeys(imdb_ids) if i]
        if not ids:
            return {}
        if not self._dataset_ready():
            if self.enabled:
                self._maybe_refresh()
            return {}

        out: dict[str, dict] = {}
        try:
            con = sqlite3.connect(self._db_path, timeout=5)
            try:
                for start in range(0, len(ids), SQL_VAR_LIMIT):
                    chunk = ids[start:start + SQL_VAR_LIMIT]
                    placeholders = ','.join('?' * len(chunk))
                    cur = con.execute(
                        f'SELECT tconst, rating, votes FROM ratings WHERE tconst IN ({placeholders})',
                        chunk,
                    )
                    for tconst, rating, votes in cur.fetchall():
                        out[tconst] = {'aggregateRating': rating, 'voteCount': votes}
            finally:
                con.close()
        except sqlite3.Error as e:
            logger.warning("IMDb ratings lookup failed: %s", e)
        return out
