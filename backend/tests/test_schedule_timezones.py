import copy
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask

from app.blueprints.schedule import schedule_bp
from app.services.schedule_service import ScheduleService, _build_trigger, MOVIE_JOB_ID, TV_JOB_ID


class ScheduleTimezoneTests(unittest.TestCase):
    def setUp(self):
        self.saved = {}
        get = patch('app.services.schedule_service.config_store.get',
                    side_effect=lambda key, default=None: copy.deepcopy(self.saved.get(key, default)))
        put = patch('app.services.schedule_service.config_store.put',
                    side_effect=lambda key, value: self.saved.update({key: copy.deepcopy(value)}))
        get.start()
        put.start()
        self.addCleanup(get.stop)
        self.addCleanup(put.stop)
        self.service = ScheduleService.__new__(ScheduleService)
        self.service._scheduler = BackgroundScheduler(timezone='UTC')
        self.service._scheduler.start(paused=True)
        self.addCleanup(self.service._scheduler.shutdown)
        self.app = Flask(__name__)
        self.app.register_blueprint(schedule_bp, url_prefix='/api/schedule')
        self.app.schedule_service = self.service
        self.client = self.app.test_client()

    def save(self, **changes):
        data = dict(mediaType='movie', preset='daily', libraries=['Movies'],
                    hour=4, minute=15, timezone='America/New_York')
        data.update(changes)
        return self.client.post('/api/schedule', json=data)

    def test_saves_local_timezone_for_both_jobs_and_restores_it(self):
        self.assertEqual(self.save().status_code, 200)
        response = self.save(mediaType='tv', libraries=['TV'], hour=5)
        self.assertEqual(response.status_code, 200)
        for key, job_id, hour in [('movie', MOVIE_JOB_ID, 4), ('tv', TV_JOB_ID, 5)]:
            self.assertEqual(self.saved['schedule'][key]['timezone'], 'America/New_York')
            view = response.json[key]
            self.assertEqual(view['timezone'], 'America/New_York')
            instant = datetime.fromisoformat(view['next_run'])
            self.assertEqual(instant.astimezone(ZoneInfo('America/New_York')).hour, hour)
            self.assertEqual(instant.utcoffset().total_seconds(), 0)
        self.service._scheduler.remove_all_jobs()
        self.service.init_app(self.app)
        self.assertEqual(str(self.service._scheduler.get_job(MOVIE_JOB_ID).trigger.timezone), 'America/New_York')
        self.assertEqual(str(self.service._scheduler.get_job(TV_JOB_ID).trigger.timezone), 'America/New_York')

    def test_daily_wall_clock_time_stays_fixed_across_both_dst_transitions(self):
        trigger = _build_trigger('daily', 4, 0, 'mon', 'America/New_York')
        for start, expected_utc_hours in [('2026-03-07', [9, 8, 8]), ('2026-10-31', [8, 9, 9])]:
            now = datetime.fromisoformat(start).replace(tzinfo=timezone.utc)
            previous = None
            for utc_hour in expected_utc_hours:
                fire = trigger.get_next_fire_time(previous, now)
                self.assertEqual((fire.hour, fire.minute), (4, 0))
                self.assertEqual(fire.astimezone(timezone.utc).hour, utc_hour)
                previous = now = fire

    def test_cadences_use_local_calendar_and_fractional_timezone_offsets(self):
        now = datetime(2026, 9, 30, 22, tzinfo=timezone.utc)
        for preset, expected in [
            ('hourly', (1, 4, 0)), ('daily', (1, 4, 15)),
            ('weekly', (5, 4, 15)), ('biweekly', (1, 4, 15)), ('monthly', (1, 4, 15)),
        ]:
            with self.subTest(preset=preset):
                trigger = _build_trigger(preset, 4, 15, 'mon', 'Asia/Kathmandu')
                fire = trigger.get_next_fire_time(None, now)
                self.assertEqual((fire.day, fire.hour, fire.minute), expected)
                self.assertEqual(fire.utcoffset().total_seconds(), 20700)

    def test_invalid_timezone_does_not_change_saved_schedule_or_jobs(self):
        self.save()
        before = copy.deepcopy(self.saved)
        job = self.service._scheduler.get_job(MOVIE_JOB_ID)
        for invalid in ['Not/AZone', '', '../UTC', 123, [], {}]:
            with self.subTest(zone=invalid):
                self.assertEqual(self.save(timezone=invalid).status_code, 400)
                self.assertEqual(self.saved, before)
                self.assertIs(self.service._scheduler.get_job(MOVIE_JOB_ID), job)

    @patch('app.services.schedule_service.get_localzone', return_value=ZoneInfo('UTC'))
    def test_legacy_schedule_is_unchanged_until_saved_in_local_zone(self, _localzone):
        self.saved['schedule'] = {'movie': dict(enabled=True, preset='monthly',
                                               libraries=['Movies'], hour=4, minute=0)}
        self.service.init_app(self.app)
        self.assertEqual(self.client.get('/api/schedule').json['movie']['timezone'], 'UTC')
        self.assertNotIn('timezone', self.saved['schedule']['movie'])
        self.save(preset='monthly', minute=0)
        self.assertEqual(str(self.service._scheduler.get_job(MOVIE_JOB_ID).trigger.timezone), 'America/New_York')
        # An older client that omits timezone must not switch it back to UTC.
        self.client.post('/api/schedule', json=dict(mediaType='movie', preset='daily', libraries=['Movies']))
        self.assertEqual(self.saved['schedule']['movie']['timezone'], 'America/New_York')


if __name__ == '__main__':
    unittest.main()
