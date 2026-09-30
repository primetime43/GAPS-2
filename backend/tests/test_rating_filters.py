import threading
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.services import scan_history
from app.services.scan_progress import ScanProgressTracker
from app.services.tmdb_service import TmdbService
from app.services.schedule_service import ScheduleService


class RatingFilterTests(unittest.TestCase):
    def setUp(self):
        self.service = TmdbService.__new__(TmdbService)
        self.service._image_base_url = 'https://example.test/'
        self.service._quality_filter_enabled = True
        self.service._min_rating = 6
        self.service._min_vote_count = 110
        self.service._cache_lock = threading.Lock()
        self.service._collection_cache = {}
        self.parts = [
            {'id': 1, 'title': 'Low rating', 'release_date': '2000-01-01', 'vote_average': 5.9, 'vote_count': 200},
            {'id': 2, 'title': 'Few votes', 'release_date': '2000-01-01', 'vote_average': 8, 'vote_count': 109},
            {'id': 3, 'title': 'At threshold', 'release_date': '2000-01-01', 'vote_average': 6, 'vote_count': 110},
            {'id': 4, 'title': 'Future', 'release_date': '2099-01-01', 'vote_average': 0, 'vote_count': 0},
        ]

    def test_scan_retains_low_rated_titles_but_notifications_obey_thresholds(self):
        gaps = self.service._build_gap_entries({'name': 'Collection', 'parts': self.parts}, set(), True)
        self.assertEqual([g['tmdbId'] for g in gaps], [1, 2, 3, 4])
        self.assertEqual([g['tmdbId'] for g in self.service.notification_gaps(gaps)], [3, 4])
        self.assertEqual(len(gaps), 4)
        owned = self.service._build_gap_entries({'parts': self.parts}, {1}, False)
        self.assertEqual([g['tmdbId'] for g in owned], [2, 3, 4])

    @patch('app.services.scan_history.config_store.get', return_value=None)
    @patch('app.services.schedule_service.load_library_cache')
    def test_scheduled_scan_saves_all_results_and_only_limits_notifications(self, load, get):
        load.return_value = ({'Movies': {'movies': [{'tmdbId': 9}], 'tmdbIds': [9]}}, None)
        gaps = self.service._build_gap_entries({'name': 'Collection', 'parts': self.parts}, {9}, True)
        self.service._api_key = 'key'
        self.service.find_collection_gaps = Mock(return_value=(gaps, None))
        self.service.persist_last_scan = Mock()
        scheduler = ScheduleService.__new__(ScheduleService)
        scheduler._app = SimpleNamespace(tmdb_service=self.service, notification_service=Mock())
        scheduler._get_media_service = Mock()
        scheduler._record_last_run = Mock()
        scheduler._run_movie_scan(['Movies'], 'plex')
        self.assertEqual(len(self.service.persist_last_scan.call_args.args[0]), 4)
        self.assertEqual(scheduler._record_last_run.call_args.kwargs['missing'], 4)
        scheduler._app.notification_service.notify_scan_results.assert_called_once_with(2, 1, 'Movies', media_type='movie')

    @patch('app.services.tmdb_service.config_store.put')
    @patch('app.services.tmdb_service.config_store.get')
    def test_old_filtered_scans_are_rebuilt_once_before_incremental_updates(self, get, put):
        prior = {'gaps': [], 'owned_keys': ['tmdb:1'], 'libraries': ['Movies']}
        get.return_value = prior
        self.assertIsNone(self.service._load_incremental_prior(['Movies']))
        gaps = self.service._build_gap_entries({'parts': self.parts}, {1}, True)
        self.service.persist_last_scan(gaps, [{'tmdbId': 1}], {1}, ['Movies'], '2026-09-24T12:00:00Z')
        saved = put.call_args.args[1]
        self.assertTrue(saved['rating_filter_complete'])
        self.assertEqual(len(saved['gaps']), 4)
        get.return_value = saved
        self.assertEqual(self.service._load_incremental_prior(['Movies']), saved)
        self.assertIsNone(self.service._load_incremental_prior(['Other']))
        tracker = ScanProgressTracker(extra_fields={'rating_filter_complete': False}, seed_key='last_scan')
        self.assertTrue(tracker.snapshot['rating_filter_complete'])

    @patch('app.services.scan_history.config_store.put')
    @patch('app.services.scan_history.config_store.get', return_value=None)
    def test_history_preserves_rating_fields_even_after_cache_expiry(self, get, put):
        gaps = self.service._build_gap_entries({'parts': self.parts}, set(), True)
        scan_history.record('movie', ['Movies'], 1, len(gaps), gaps=gaps)
        saved = put.call_args.args[1][0]
        self.assertEqual(saved['missing'], 4)
        self.assertTrue(saved['rating_filter_complete'])
        hydrated = self.service.hydrate_gaps(saved['gaps'])
        self.assertEqual(hydrated[0]['voteAverage'], 5.9)
        self.assertEqual(hydrated[0]['voteCount'], 200)
        self.assertEqual(hydrated[0]['releaseDate'], '2000-01-01')


if __name__ == '__main__':
    unittest.main()
