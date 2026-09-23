import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.services.schedule_service import ScheduleService


class ScheduleSourceTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    @patch('app.services.schedule_service.config_store.put')
    def test_schedules_keep_independent_servers_including_legacy_configs(self, put):
        scheduler = ScheduleService.__new__(ScheduleService)
        cfg = {'source': 'plex', 'movie': {'enabled': True, 'libraries': ['Movies']}, 'tv': {}}
        scheduler._load_config = Mock(side_effect=lambda: cfg)
        scheduler._add_job = Mock()
        scheduler._app = self.app
        scheduler._run_movie_scan = Mock()
        scheduler._run_tv_scan = Mock()
        self.assertTrue(scheduler.set_schedule('tv', 'daily', ['TV'], 'jellyfin'))
        scheduler._run_movie_scan_job()
        scheduler._run_tv_scan_job()
        scheduler._run_movie_scan.assert_called_once_with(['Movies'], 'plex')
        scheduler._run_tv_scan.assert_called_once_with(['TV'], 'jellyfin')


if __name__ == '__main__':
    unittest.main()
