import copy
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from flask import Flask
from app.blueprints.schedule import schedule_bp
from app.services.schedule_service import (
    ScheduleService, HISTORY_KEY, HISTORY_LIMIT_KEY, LEGACY_LAST_RUN_KEY,
)


class ScheduleHistoryTests(unittest.TestCase):
    def setUp(self):
        self.saved = {}
        get = patch('app.services.schedule_service.config_store.get',
                    side_effect=lambda key, default=None: copy.deepcopy(self.saved.get(key, default)))
        put = patch('app.services.schedule_service.config_store.put',
                    side_effect=lambda key, value: self.saved.update({key: copy.deepcopy(value)}))
        mirror = patch('app.services.schedule_service.scan_history.record')
        self.get = get.start()
        self.put = put.start()
        self.mirror = mirror.start()
        self.addCleanup(get.stop)
        self.addCleanup(put.stop)
        self.addCleanup(mirror.stop)
        self.service = ScheduleService.__new__(ScheduleService)
        self.service._scheduler = Mock()
        self.service._scheduler.get_job.return_value = None
        app = Flask(__name__)
        app.register_blueprint(schedule_bp, url_prefix='/api/schedule')
        app.schedule_service = self.service
        self.client = app.test_client()

    def test_default_limit_and_new_runs_keep_newest_fifty(self):
        for i in range(55):
            self.service._record_last_run('success', ['Movies'], missing=i)
        self.assertEqual(len(self.saved[HISTORY_KEY]), 50)
        self.assertEqual([row['missing'] for row in self.saved[HISTORY_KEY]], list(range(54, 4, -1)))
        config = self.client.get('/api/schedule').json
        self.assertEqual(config['historyLimit'], 50)
        self.assertEqual(len(config['run_history']), 50)

    def test_saving_limit_prunes_existing_runs_and_applies_to_future_runs(self):
        self.saved[HISTORY_KEY] = [{'missing': n} for n in range(25, 0, -1)]
        response = self.client.put('/api/schedule/history', json={'historyLimit': 10})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['historyLimit'], 10)
        self.assertEqual(len(response.json['run_history']), 10)
        self.assertEqual(self.saved[HISTORY_KEY][-1]['missing'], 16)
        self.service._record_last_run('success', ['TV'], missing=99, media_type='tv')
        self.assertEqual(len(self.saved[HISTORY_KEY]), 10)
        self.assertEqual(self.saved[HISTORY_KEY][0]['missing'], 99)
        self.assertEqual(self.saved[HISTORY_KEY][-1]['missing'], 17)
        self.assertEqual(self.mirror.call_count, 1)

    def test_increasing_limit_retains_more_runs_without_restoring_deleted_ones(self):
        self.saved[HISTORY_KEY] = [{'missing': i} for i in range(50)]
        self.service.set_history_limit(10)
        self.service.set_history_limit(100)
        self.assertEqual(len(self.saved[HISTORY_KEY]), 10)
        for i in range(50):
            self.service._record_last_run('success', ['TV'], missing=i, media_type='tv')
        self.assertEqual(len(self.saved[HISTORY_KEY]), 60)

    def test_invalid_limits_are_rejected_without_writes(self):
        for value in (None, 0, 9, 501, -1, 10.5, True, '50', [], {}):
            with self.subTest(value=value):
                response = self.client.put('/api/schedule/history', json={'historyLimit': value})
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.put('/api/schedule/history', json=[10]).status_code, 400)
        self.put.assert_not_called()

    def test_limit_changes_do_not_overwrite_schedules_or_saved_scan_results(self):
        self.saved.update({'schedule': {'movie': {'enabled': True, 'source': 'plex'},
                                        'tv': {'enabled': True, 'source': 'jellyfin'}},
                           'scan_history': [{'id': 'saved-scan'}]})
        before = copy.deepcopy(self.saved)
        self.service.set_history_limit(25)
        self.assertEqual(self.saved['schedule'], before['schedule'])
        self.assertEqual(self.saved['scan_history'], before['scan_history'])
        self.mirror.assert_not_called()

    def test_legacy_history_and_invalid_stored_limit_have_safe_defaults(self):
        self.saved[LEGACY_LAST_RUN_KEY] = {'status': 'success', 'missing': 3}
        self.saved[HISTORY_LIMIT_KEY] = 'invalid'
        config = self.client.get('/api/schedule').json
        self.assertEqual(config['historyLimit'], 50)
        self.assertEqual(config['run_history'], [self.saved[LEGACY_LAST_RUN_KEY]])
        self.service._record_last_run('success', ['TV'], missing=2, media_type='tv')
        self.assertEqual(len(self.saved[HISTORY_KEY]), 2)

    def test_concurrent_movie_and_tv_records_are_not_lost(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda i: self.service._record_last_run(
                'success', ['Library'], missing=i, media_type='tv' if i % 2 else 'movie'), range(30)))
        self.assertEqual(len(self.saved[HISTORY_KEY]), 30)
        self.assertEqual({run['missing'] for run in self.saved[HISTORY_KEY]}, set(range(30)))

    def test_records_store_library_and_server_context_for_separate_trend_lines(self):
        self.service._record_last_run('success', ['TV', '4K'], source='plex', server='Basement', media_type='tv')
        row = self.saved[HISTORY_KEY][0]
        self.assertEqual(row['libraries'], ['TV', '4K'])
        self.assertEqual(row['source'], 'plex')
        self.assertEqual(row['server'], 'Basement')

    def test_storage_failure_is_reported(self):
        self.put.side_effect = OSError('unavailable')
        response = self.client.put('/api/schedule/history', json={'historyLimit': 25})
        self.assertEqual(response.status_code, 500)
        self.assertIn('Could not save', response.json['error'])
