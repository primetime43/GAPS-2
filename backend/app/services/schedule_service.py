import logging
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services import config_store, scan_history
from app.services.media_servers import media_service_for

logger = logging.getLogger(__name__)

HISTORY_KEY = 'schedule_run_history'
LEGACY_LAST_RUN_KEY = 'schedule_last_run'  # 2.4.0 single-record format; migrated on first new write
MAX_HISTORY = 50

# Schedule frequencies. The time of day (hour/minute) and, for weekly, the day
# of week are user-configurable — only the cadence is fixed per option.
SCHEDULE_FREQUENCIES = {
    'hourly': 'Hourly',
    'daily': 'Daily',
    'weekly': 'Weekly',
    'biweekly': 'Bi-weekly (1st & 15th)',
    'monthly': 'Monthly (1st)',
}

DAY_NAMES = {
    'mon': 'Monday', 'tue': 'Tuesday', 'wed': 'Wednesday', 'thu': 'Thursday',
    'fri': 'Friday', 'sat': 'Saturday', 'sun': 'Sunday',
}

DEFAULT_HOUR = 4
DEFAULT_MINUTE = 0
DEFAULT_DOW = 'mon'

MOVIE_JOB_ID = 'scheduled_movie_scan'
TV_JOB_ID = 'scheduled_tv_scan'


def _build_trigger(preset: str, hour: int, minute: int, day_of_week: str):
    """Build a CronTrigger for a frequency at the chosen time. Hourly ignores
    the hour (runs every hour at the top); only weekly uses day_of_week."""
    if preset == 'hourly':
        return CronTrigger(minute=0)
    if preset == 'daily':
        return CronTrigger(hour=hour, minute=minute)
    if preset == 'weekly':
        return CronTrigger(day_of_week=day_of_week, hour=hour, minute=minute)
    if preset == 'biweekly':
        return CronTrigger(day='1,15', hour=hour, minute=minute)
    if preset == 'monthly':
        return CronTrigger(day=1, hour=hour, minute=minute)
    return None


def _format_time(hour: int, minute: int) -> str:
    suffix = 'AM' if hour < 12 else 'PM'
    h12 = hour % 12 or 12
    return f"{h12}:{minute:02d} {suffix}"


def _describe(preset: str, hour: int, minute: int, day_of_week: str) -> str:
    """Human-readable description of a schedule, e.g. 'Weekly on Wednesday at 6:00 AM'."""
    if preset == 'hourly':
        return 'Hourly (on the hour)'
    when = _format_time(hour, minute)
    if preset == 'daily':
        return f"Daily at {when}"
    if preset == 'weekly':
        return f"Weekly on {DAY_NAMES.get(day_of_week, 'Monday')} at {when}"
    if preset == 'biweekly':
        return f"Bi-weekly (1st & 15th) at {when}"
    if preset == 'monthly':
        return f"Monthly (1st) at {when}"
    return SCHEDULE_FREQUENCIES.get(preset, '')


class ScheduleService:
    """Two independent scheduled scans — movies and TV — each with its own cadence."""

    def __init__(self):
        self._scheduler = BackgroundScheduler(daemon=True)
        self._scheduler.start()
        self._app = None  # Set after app init

    def init_app(self, app):
        """Store app reference and restore saved schedules."""
        self._app = app
        cfg = self._load_config()
        movie = cfg.get('movie', {})
        tv = cfg.get('tv', {})
        if movie.get('enabled') and movie.get('preset') in SCHEDULE_FREQUENCIES:
            self._add_job(MOVIE_JOB_ID, movie, self._run_movie_scan_job)
        if tv.get('enabled') and tv.get('preset') in SCHEDULE_FREQUENCIES:
            self._add_job(TV_JOB_ID, tv, self._run_tv_scan_job)

    # -- Config (nested movie/tv shape, migrated from the old flat format) --

    def _load_config(self) -> dict:
        saved = config_store.get('schedule', {}) or {}
        if 'movie' in saved or 'tv' in saved:
            return saved
        if not saved:
            return {'source': 'plex', 'movie': {}, 'tv': {}}
        # Migrate the legacy flat {enabled, preset, library, tv_library, source} shape.
        migrated = {'source': saved.get('source', 'plex'), 'movie': {}, 'tv': {}}
        enabled = saved.get('enabled', False)
        preset = saved.get('preset', '')
        if saved.get('library'):
            migrated['movie'] = {'enabled': enabled, 'preset': preset, 'library': saved['library']}
        if saved.get('tv_library'):
            migrated['tv'] = {'enabled': enabled, 'preset': preset, 'library': saved['tv_library']}
        config_store.put('schedule', migrated)
        return migrated

    def _get_media_service(self, source: str):
        return media_service_for(self._app, source)

    # -- Job wrappers --

    def _run_movie_scan_job(self):
        if not self._app:
            logger.error("Scheduled movie scan skipped: app context not initialized")
            return
        with self._app.app_context():
            cfg = self._load_config()
            library = cfg.get('movie', {}).get('library', '')
            source = cfg.get('source', 'plex')
            if library:
                self._run_movie_scan(library, source)

    def _run_tv_scan_job(self):
        if not self._app:
            logger.error("Scheduled TV scan skipped: app context not initialized")
            return
        with self._app.app_context():
            cfg = self._load_config()
            library = cfg.get('tv', {}).get('library', '')
            source = cfg.get('source', 'plex')
            if library:
                self._run_tv_scan(library, source)

    def _run_movie_scan(self, library_name: str, source: str):
        try:
            logger.info("Scheduled movie scan started for library '%s' (source=%s)", library_name, source)
            tmdb = self._app.tmdb_service
            media_service = self._get_media_service(source)

            api_key = tmdb.api_key
            if not api_key:
                logger.warning("Scheduled movie scan skipped: no TMDB API key configured")
                self._record_last_run(
                    status='skipped', library=library_name, message='no TMDB API key configured'
                )
                return

            cache = media_service.movies_cache
            if library_name not in cache:
                media_service.get_movies(library_name)
                cache = media_service.movies_cache

            library_data = cache.get(library_name, {})
            owned_movies = library_data.get('movies', [])
            owned_ids = set(library_data.get('tmdbIds', []))

            if not owned_movies:
                logger.warning("Scheduled movie scan skipped: library '%s' has no movies", library_name)
                self._record_last_run(
                    status='skipped', library=library_name,
                    message='library has no movies (server unreachable or library empty)',
                )
                return

            gaps, error = tmdb.find_collection_gaps(
                api_key=api_key, owned_movies=owned_movies, owned_tmdb_ids=owned_ids, show_existing=True,
            )
            if error:
                logger.error("Scheduled movie scan failed for '%s': %s", library_name, error)
                self._record_last_run(status='error', library=library_name, message=str(error))
                return

            missing = [g for g in (gaps or []) if not g.get('owned')]
            missing = scan_history.actionable_missing('movie', missing)
            collections = len(set(g['collectionName'] for g in missing)) if missing else 0
            logger.info(
                "Scheduled movie scan complete for '%s': %d missing across %d collections",
                library_name, len(missing), collections,
            )
            self._record_last_run(
                status='success', library=library_name, missing=len(missing),
                collections=collections, total_owned=len(owned_ids),
                gaps=missing,
            )
            self._app.notification_service.notify_scan_results(
                len(missing), collections, library_name, media_type='movie'
            )
        except Exception as e:
            logger.exception("Scheduled movie scan crashed unexpectedly")
            self._record_last_run(status='error', library=library_name, message=str(e))

    def _run_tv_scan(self, tv_library: str, source: str):
        try:
            logger.info("Scheduled TV scan started for library '%s' (source=%s)", tv_library, source)
            tvdb = self._app.tvdb_service
            media_service = self._get_media_service(source)

            if not tvdb.is_configured:
                logger.warning("Scheduled TV scan skipped: TheTVDB not configured")
                self._record_last_run(
                    status='skipped', library=tv_library,
                    message='TheTVDB not configured', media_type='tv',
                )
                return

            cache = media_service.shows_cache
            if tv_library not in cache:
                media_service.get_shows(tv_library)
                cache = media_service.shows_cache

            library_data = cache.get(tv_library, {})
            owned_shows = library_data.get('shows', [])
            owned_ids = set(library_data.get('tvdbIds', []))

            if not owned_ids:
                logger.warning("Scheduled TV scan skipped: library '%s' has no shows with TheTVDB IDs", tv_library)
                self._record_last_run(
                    status='skipped', library=tv_library,
                    message='library has no shows with TheTVDB IDs (server unreachable or library empty)',
                    media_type='tv',
                )
                return

            gaps = tvdb.find_franchise_gaps(owned_shows, owned_ids, show_existing=True)
            try:
                config_store.put('last_tv_scan', {
                    'gaps': gaps,
                    'total_owned': len(owned_ids),
                    'libraries': [tv_library],
                    'completed_at': datetime.now(timezone.utc).isoformat(),
                })
            except OSError as e:
                logger.warning("Failed to persist last_tv_scan: %s", e)

            missing = [g for g in (gaps or []) if not g.get('owned')]
            missing = scan_history.actionable_missing('tv', missing)
            franchises = len(set(g['franchiseName'] for g in missing)) if missing else 0
            logger.info(
                "Scheduled TV scan complete for '%s': %d missing across %d franchises",
                tv_library, len(missing), franchises,
            )
            self._record_last_run(
                status='success', library=tv_library, missing=len(missing),
                collections=franchises, media_type='tv', total_owned=len(owned_ids),
                gaps=missing,
            )
            self._app.notification_service.notify_scan_results(
                len(missing), franchises, tv_library, media_type='tv'
            )
        except Exception as e:
            logger.exception("Scheduled TV scan crashed unexpectedly")
            self._record_last_run(status='error', library=tv_library, message=str(e), media_type='tv')

    # -- Run history --

    @staticmethod
    def _record_last_run(
        status: str,
        library: str,
        missing: int = 0,
        collections: int = 0,
        message: str = '',
        media_type: str = 'movie',
        total_owned: int = 0,
        gaps: list[dict] | None = None,
    ) -> None:
        timestamp = datetime.now(timezone.utc).isoformat()
        entry = {
            'timestamp': timestamp,
            'status': status,
            'library': library,
            'missing': missing,
            'collections': collections,
            'message': message,
            'mediaType': media_type,
        }
        try:
            history = ScheduleService._load_history()
            history.insert(0, entry)
            del history[MAX_HISTORY:]
            config_store.put(HISTORY_KEY, history)
        except OSError as e:
            logger.warning("Failed to persist scheduled scan history: %s", e)
        # Mirror into the unified scan history so the dashboard sees scheduled
        # runs alongside manual ones.
        scan_history.record(
            media_type=media_type,
            libraries=[library] if library else [],
            total_owned=total_owned,
            missing=missing,
            status=status,
            trigger='scheduled',
            message=message,
            completed_at=timestamp,
            gaps=gaps,
        )

    @staticmethod
    def _load_history() -> list[dict]:
        history = config_store.get(HISTORY_KEY)
        if isinstance(history, list):
            return list(history)
        legacy = config_store.get(LEGACY_LAST_RUN_KEY)
        if isinstance(legacy, dict):
            return [legacy]
        return []

    # -- Job management --

    def _add_job(self, job_id: str, block: dict, func) -> None:
        trigger = _build_trigger(
            block.get('preset', ''),
            int(block.get('hour', DEFAULT_HOUR)),
            int(block.get('minute', DEFAULT_MINUTE)),
            block.get('dayOfWeek', DEFAULT_DOW),
        )
        if trigger is None:
            return
        self._scheduler.add_job(func, trigger=trigger, id=job_id, replace_existing=True)

    def set_schedule(
        self,
        media_type: str,
        preset: str,
        library: str,
        source: str = 'plex',
        hour: int = DEFAULT_HOUR,
        minute: int = DEFAULT_MINUTE,
        day_of_week: str = DEFAULT_DOW,
    ) -> bool:
        """Enable a per-media-type schedule with its own cadence and time."""
        if preset not in SCHEDULE_FREQUENCIES:
            return False
        try:
            hour = int(hour)
            minute = int(minute)
        except (TypeError, ValueError):
            return False
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return False
        if day_of_week not in DAY_NAMES:
            day_of_week = DEFAULT_DOW

        key = 'tv' if media_type == 'tv' else 'movie'
        cfg = self._load_config()
        cfg['source'] = source
        cfg.setdefault('movie', {})
        cfg.setdefault('tv', {})
        cfg[key] = {
            'enabled': True, 'preset': preset, 'library': library,
            'hour': hour, 'minute': minute, 'dayOfWeek': day_of_week,
        }
        config_store.put('schedule', cfg)

        job_id = TV_JOB_ID if key == 'tv' else MOVIE_JOB_ID
        func = self._run_tv_scan_job if key == 'tv' else self._run_movie_scan_job
        self._add_job(job_id, cfg[key], func)
        return True

    def disable_schedule(self, media_type: str) -> None:
        """Disable a single media type's schedule (leaves the other intact)."""
        key = 'tv' if media_type == 'tv' else 'movie'
        cfg = self._load_config()
        if isinstance(cfg.get(key), dict):
            cfg[key]['enabled'] = False
        config_store.put('schedule', cfg)
        try:
            self._scheduler.remove_job(TV_JOB_ID if key == 'tv' else MOVIE_JOB_ID)
        except Exception:
            pass

    def get_schedule(self) -> dict:
        cfg = self._load_config()
        movie = cfg.get('movie', {})
        tv = cfg.get('tv', {})
        movie_job = self._scheduler.get_job(MOVIE_JOB_ID)
        tv_job = self._scheduler.get_job(TV_JOB_ID)
        history = ScheduleService._load_history()

        movie_block = self._block_view(movie, movie_job)
        tv_block = self._block_view(tv, tv_job)

        # Earliest upcoming run across both, for the dashboard summary.
        next_runs = [b['next_run'] for b in (movie_block, tv_block) if b['next_run']]
        next_run = min(next_runs) if next_runs else None
        active = movie_block if movie_block['enabled'] else tv_block

        return {
            'source': cfg.get('source', 'plex'),
            'movie': movie_block,
            'tv': tv_block,
            'last_run': history[0] if history else None,
            'run_history': history,
            'presets': dict(SCHEDULE_FREQUENCIES),
            'days': dict(DAY_NAMES),
            # Convenience fields for the dashboard (either schedule active).
            'enabled': movie_block['enabled'] or tv_block['enabled'],
            'preset': movie_block['preset'] or tv_block['preset'],
            'description': active['description'],
            'next_run': next_run,
        }

    @staticmethod
    def _block_view(block: dict, job) -> dict:
        """Shape a stored schedule block for the API, adding the resolved time
        fields and a human-readable description."""
        preset = block.get('preset', '')
        hour = int(block.get('hour', DEFAULT_HOUR))
        minute = int(block.get('minute', DEFAULT_MINUTE))
        day_of_week = block.get('dayOfWeek', DEFAULT_DOW)
        return {
            'enabled': block.get('enabled', False),
            'preset': preset,
            'library': block.get('library', ''),
            'hour': hour,
            'minute': minute,
            'dayOfWeek': day_of_week,
            'description': _describe(preset, hour, minute, day_of_week) if preset else '',
            'next_run': str(job.next_run_time) if job else None,
        }
