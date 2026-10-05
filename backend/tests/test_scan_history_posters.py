import copy
import threading
import unittest
from unittest.mock import Mock, patch

import requests
from flask import Flask

from app.blueprints.scan_history import scan_history_bp
from app.services import scan_history
from app.services.tmdb_service import TmdbService
from app.services.tvdb_service import TvdbService


class ScanHistoryPosterTests(unittest.TestCase):
    def setUp(self):
        self.history = []
        self.get = patch('app.services.scan_history.config_store.get', side_effect=self.read).start()
        self.put = patch('app.services.scan_history.config_store.put', side_effect=self.write).start()
        self.addCleanup(patch.stopall)
        self.movie = TmdbService.__new__(TmdbService)
        self.movie._cache_lock = threading.Lock()
        self.movie._collection_cache = {}
        self.movie._base_url = 'https://tmdb.test'
        self.movie._image_base_url = 'https://images.test'
        self.movie._api_key = 'test'
        self.movie._language = 'en'
        self.movie._session = Mock()
        self.tv = TvdbService.__new__(TvdbService)
        self.tv._cache_lock = threading.Lock()
        self.tv._series_cache = {}
        self.tv._request = Mock()
        self.app = Flask(__name__)
        self.app.tmdb_service = self.movie
        self.app.tvdb_service = self.tv
        self.app.register_blueprint(scan_history_bp, url_prefix='/scan-history')
        self.client = self.app.test_client()

    def read(self, key, default=None):
        if key == 'scan_history':
            return copy.deepcopy(self.history)
        if key == 'tvdb':
            return {'api_key': 'test'}
        return default

    def write(self, key, value):
        self.assertEqual(key, 'scan_history')
        self.history = copy.deepcopy(value)

    def seed(self, media_type, **fields):
        id_key = 'tvdbId' if media_type == 'tv' else 'tmdbId'
        gap = {id_key: 1, 'name': 'Saved title', 'year': '2000', 'owned': False, **fields}
        entry = {'id': 'saved', 'mediaType': media_type, 'gaps': [gap],
                 'libraries': ['Library'], 'totalOwned': 5, 'missing': 1}
        self.history = [entry]
        return gap

    def reopen(self):
        response = self.client.get('/scan-history/saved/gaps')
        self.assertEqual(response.status_code, 200)
        return response.json['gaps']

    def test_new_history_preserves_posters_after_cache_expiry(self):
        for media_type in ('movie', 'tv'):
            with self.subTest(media_type=media_type):
                gap = self.seed(media_type, posterUrl='https://images.test/saved.jpg')
                scan_history.record(media_type, ['Library'], 5, 1, gaps=[gap])
                entry = self.history[0]
                response = self.client.get(f"/scan-history/{entry['id']}/gaps")
                self.assertEqual(response.json['gaps'][0]['posterUrl'], gap['posterUrl'])
                self.assertEqual(entry['missing'], 1)
        self.movie._session.get.assert_not_called()
        self.tv._request.assert_not_called()

    def test_legacy_cache_misses_recover_and_persist_without_changing_scan(self):
        for media_type in ('movie', 'tv'):
            with self.subTest(media_type=media_type):
                gap = self.seed(media_type)
                original = copy.deepcopy(self.history[0])
                self.movie._session.get.return_value = Mock(status_code=200)
                self.movie._session.get.return_value.json.return_value = {'poster_path': '/recovered.jpg'}
                self.tv._request.return_value = Mock(status_code=200)
                self.tv._request.return_value.json.return_value = {'data': {'image': 'https://images.test/recovered.jpg'}}
                gaps = self.reopen()
                self.assertEqual(gaps[0]['posterUrl'], 'https://images.test/recovered.jpg')
                original['gaps'][0]['posterUrl'] = gaps[0]['posterUrl']
                self.assertEqual(self.history[0], original)
                self.tv._series_cache.clear()
                self.movie._session.get.reset_mock()
                self.tv._request.reset_mock()
                self.assertEqual(self.reopen()[0]['posterUrl'], gaps[0]['posterUrl'])
                self.movie._session.get.assert_not_called()
                self.tv._request.assert_not_called()

    def test_warm_cache_posters_are_backfilled_without_network(self):
        self.movie._collection_cache = {10: {'parts': [{'id': 1, 'poster_path': '/warm.jpg'}]}}
        self.tv._series_cache = {1: {'image': 'https://images.test/warm.jpg'}}
        for media_type in ('movie', 'tv'):
            with self.subTest(media_type=media_type):
                self.seed(media_type)
                self.assertEqual(self.reopen()[0]['posterUrl'], 'https://images.test/warm.jpg')
                self.assertEqual(self.history[0]['gaps'][0]['posterUrl'], 'https://images.test/warm.jpg')
        self.movie._session.get.assert_not_called()
        self.tv._request.assert_not_called()

    def test_empty_cached_artwork_does_not_erase_saved_poster(self):
        self.movie._collection_cache = {10: {'parts': [{'id': 1, 'poster_path': None}]}}
        self.tv._series_cache = {1: {'image': None}}
        for media_type in ('movie', 'tv'):
            with self.subTest(media_type=media_type):
                self.seed(media_type, posterUrl='https://images.test/saved.jpg')
                self.assertEqual(self.reopen()[0]['posterUrl'], 'https://images.test/saved.jpg')

    def test_provider_failures_preserve_results_and_allow_retry(self):
        for failure in (requests.Timeout('offline'), ValueError('invalid JSON')):
            for media_type in ('movie', 'tv'):
                with self.subTest(media_type=media_type, failure=failure):
                    gap = self.seed(media_type)
                    self.movie._session.get.side_effect = failure
                    self.tv._request.side_effect = failure
                    self.assertEqual(self.reopen(), [gap])
                    self.assertNotIn('posterUrl', self.history[0]['gaps'][0])

    def test_known_missing_artwork_does_not_trigger_repeated_lookups(self):
        for media_type in ('movie', 'tv'):
            with self.subTest(media_type=media_type):
                self.seed(media_type, posterUrl=None)
                self.assertIsNone(self.reopen()[0]['posterUrl'])
        self.movie._session.get.assert_not_called()
        self.tv._request.assert_not_called()

    def test_recovery_deduplicates_titles_but_keeps_both_groups(self):
        self.seed('movie', collectionName='First')
        self.history[0]['gaps'].append({**self.history[0]['gaps'][0], 'collectionName': 'Second'})
        self.movie._session.get.return_value = Mock(status_code=200)
        self.movie._session.get.return_value.json.return_value = {'poster_path': '/recovered.jpg'}
        gaps = self.reopen()
        self.movie._session.get.assert_called_once()
        self.assertEqual([g['collectionName'] for g in gaps], ['First', 'Second'])
        self.assertTrue(all(g['posterUrl'] for g in gaps))

    def test_backfill_keeps_newer_history_entries(self):
        gap = self.seed('tv')
        self.history.insert(0, {'id': 'newer', 'gaps': []})
        scan_history.save_posters('saved', 'tv', [{**gap, 'posterUrl': 'poster'}])
        self.assertEqual([e['id'] for e in self.history], ['newer', 'saved'])
        self.assertEqual(self.history[1]['gaps'][0]['posterUrl'], 'poster')

    def test_unknown_scan_returns_404(self):
        self.assertEqual(self.client.get('/scan-history/missing/gaps').status_code, 404)


if __name__ == '__main__':
    unittest.main()
