from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from app.services import config_store

# Preset schedule options with cron expressions
SCHEDULE_PRESETS = {
    'hourly': {'trigger': CronTrigger(minute=0), 'label': 'Every hour'},
    'daily': {'trigger': CronTrigger(hour=4, minute=0), 'label': 'Daily at 4:00 AM'},
    'weekly': {'trigger': CronTrigger(day_of_week='mon', hour=4, minute=0), 'label': 'Weekly (Monday 4:00 AM)'},
    'biweekly': {'trigger': CronTrigger(day='1,15', hour=4, minute=0), 'label': 'Bi-weekly (1st & 15th)'},
    'monthly': {'trigger': CronTrigger(day=1, hour=4, minute=0), 'label': 'Monthly (1st)'},
}

JOB_ID = 'scheduled_scan'


class ScheduleService:
    def __init__(self):
        self._scheduler = BackgroundScheduler(daemon=True)
        self._scheduler.start()
        self._app = None  # Set after app init

    def init_app(self, app):
        """Store app reference and restore saved schedule."""
        self._app = app
        saved = config_store.get('schedule')
        if saved and saved.get('enabled') and saved.get('preset') in SCHEDULE_PRESETS:
            self._add_job(saved['preset'])

    def _run_scan(self):
        """Execute a scan using the saved library config."""
        if not self._app:
            return

        with self._app.app_context():
            config = config_store.get('schedule', {})
            library_name = config.get('library', '')
            if not library_name:
                return

            tmdb = self._app.tmdb_service
            plex = self._app.plex_service

            api_key = tmdb.api_key
            if not api_key:
                return

            # Load movies if not cached
            cache = plex.movies_cache
            if library_name not in cache:
                plex.get_movies(library_name)
                cache = plex.movies_cache

            library_data = cache.get(library_name, {})
            owned_movies = library_data.get('movies', [])
            owned_ids = set(library_data.get('tmdbIds', []))

            if not owned_movies:
                return

            tmdb.find_collection_gaps(
                api_key=api_key,
                owned_movies=owned_movies,
                owned_tmdb_ids=owned_ids,
                show_existing=True,
            )

    def _add_job(self, preset: str) -> None:
        """Add or replace the scheduled job."""
        self._scheduler.remove_all_jobs()
        trigger = SCHEDULE_PRESETS[preset]['trigger']
        self._scheduler.add_job(
            self._run_scan,
            trigger=trigger,
            id=JOB_ID,
            replace_existing=True,
        )

    def set_schedule(self, preset: str, library: str) -> bool:
        """Enable a schedule with the given preset and library."""
        if preset not in SCHEDULE_PRESETS:
            return False
        self._add_job(preset)
        config_store.put('schedule', {
            'enabled': True,
            'preset': preset,
            'library': library,
        })
        return True

    def disable_schedule(self) -> None:
        """Disable the scheduled scan."""
        self._scheduler.remove_all_jobs()
        saved = config_store.get('schedule', {})
        saved['enabled'] = False
        config_store.put('schedule', saved)

    def get_schedule(self) -> dict:
        """Get the current schedule config."""
        saved = config_store.get('schedule', {})
        job = self._scheduler.get_job(JOB_ID)
        return {
            'enabled': saved.get('enabled', False),
            'preset': saved.get('preset', ''),
            'library': saved.get('library', ''),
            'next_run': str(job.next_run_time) if job else None,
            'presets': {k: v['label'] for k, v in SCHEDULE_PRESETS.items()},
        }
