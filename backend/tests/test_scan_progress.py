import unittest
from unittest.mock import Mock, patch

from app.services.scan_progress import ScanProgressTracker
from app.services.tmdb_service import TmdbService
from app.services.tvdb_service import TvdbService


class ScanProgressTests(unittest.TestCase):
    def tracker(self):
        with patch('app.services.scan_progress.config_store.get', return_value=None):
            return ScanProgressTracker(extra_fields={}, seed_key='last_scan')

    def test_scheduled_updates_do_not_overwrite_manual_progress(self):
        tracker = self.tracker()
        generation = tracker.begin(total=10, total_owned=10, libraries=['Manual'])
        tracker.update(generation, processed=3)
        before = tracker.snapshot
        self.assertFalse(tracker.update(None, processed=100, total=500, current_movie='Scheduled'))
        self.assertEqual(tracker.snapshot, before)
        self.assertTrue(tracker.is_current(None))
        self.assertTrue(tracker.update(generation, processed=4))

    def test_cancelled_workers_cannot_change_new_scan_progress(self):
        tracker = self.tracker()
        old = tracker.begin(total=1, total_owned=1, libraries=['Old'])
        tracker.cancel()
        current = tracker.begin(total=2, total_owned=2, libraries=['New'])
        self.assertFalse(tracker.update(old, processed=1))
        self.assertFalse(tracker.fail(old, 'Old error'))
        self.assertFalse(tracker.finish(old, gaps=[], total_owned=1, completed_at='old'))
        self.assertEqual(tracker.snapshot['libraries'], ['New'])
        self.assertEqual(tracker.snapshot['status'], 'scanning')
        self.assertTrue(tracker.fail(current, 'Current error'))
        self.assertEqual(tracker.snapshot['error'], 'Current error')

    @patch('app.services.scan_history.record')
    def test_errors_from_cancelled_workers_do_not_create_failed_history(self, record):
        for cls in (TmdbService, TvdbService):
            with self.subTest(service=cls.__name__):
                service = cls.__new__(cls)
                service._scan = self.tracker()
                generation = service._scan.begin(total=1, total_owned=1, libraries=['Old'])

                def cancelled_request(*args, **kwargs):
                    service._scan.cancel()
                    service._scan.begin(total=2, total_owned=2, libraries=['New'])
                    raise RuntimeError('Old request failed')

                if cls is TmdbService:
                    service.find_collection_gaps = Mock(side_effect=cancelled_request)
                    service._run_scan('key', [], set(), False, ['Old'], generation)
                else:
                    service.find_franchise_gaps = Mock(side_effect=cancelled_request)
                    service._run_scan([], set(), False, ['Old'], generation)
                self.assertEqual(service._scan.snapshot['status'], 'scanning')
                record.assert_not_called()
