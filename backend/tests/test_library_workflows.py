import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.recommendations import recommendations_bp
from app.blueprints.tvdb import tvdb_bp
from app.services.schedule_service import ScheduleService


class LibraryWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(recommendations_bp, url_prefix='/api/recommendations')
        self.app.register_blueprint(tvdb_bp, url_prefix='/api/tvdb')
        self.app.tmdb_service = Mock(api_key='key', scan_progress={'status': 'idle'})
        self.app.tvdb_service = Mock(is_configured=True, scan_progress={'status': 'idle'})
        self.app.tmdb_service.find_gaps_for_movie.return_value = ([], None)
        self.app.tmdb_service.find_similar_movies.return_value = ([], None)
        self.app.tmdb_service.start_scan.return_value = False
        self.app.tvdb_service.find_gaps_for_show.return_value = ([], None)
        self.media = Mock(movies_cache={}, shows_cache={})
        self.app.plex_service = self.media
        self.app.notification_service = Mock()
        self.media.get_movies.side_effect = lambda name: self.load_library(name, 'movie')
        self.media.get_shows.side_effect = lambda name: self.load_library(name, 'tv')
        self.media.clear_movies_cache.side_effect = self.media.movies_cache.clear
        self.media.clear_shows_cache.side_effect = self.media.shows_cache.clear
        self.client = self.app.test_client()

    def load_library(self, name, media_type):
        if name == 'Broken':
            return None, 'HTTP 503'
        item = {'name': name, 'year': 2020, 'tmdbId': 10, 'tvdbId': 20}
        if media_type == 'tv':
            self.media.shows_cache[name] = {'shows': [item], 'tvdbIds': [20]}
        else:
            self.media.movies_cache[name] = {'movies': [item], 'tmdbIds': [10]}
        return [item], None

    def request_workflow(self, path, names):
        if path.endswith('/scan'):
            return self.client.post(path, json={'libraryNames': names})
        return self.client.get(path, query_string={'movieId': 10, 'tvdbId': 20, 'libraryNames': names})

    def test_all_ownership_workflows_load_cold_libraries(self):
        for path in ['/api/recommendations/movie', '/api/recommendations/similar',
                     '/api/recommendations/scan', '/api/tvdb/show', '/api/tvdb/scan']:
            with self.subTest(path=path):
                self.media.movies_cache.clear()
                self.media.shows_cache.clear()
                self.assertEqual(self.request_workflow(path, ['Library']).status_code, 200)
                cache = self.media.shows_cache if '/tvdb/' in path else self.media.movies_cache
                self.assertIn('Library', cache)
        self.assertEqual(self.app.tmdb_service.find_gaps_for_movie.call_args.kwargs['owned_tmdb_ids'], {10})
        self.assertEqual(self.app.tvdb_service.find_gaps_for_show.call_args.args[1], {20})

    def test_partial_library_failures_abort_all_ownership_workflows(self):
        for path in ['/api/recommendations/movie', '/api/recommendations/similar',
                     '/api/recommendations/scan', '/api/tvdb/show', '/api/tvdb/scan']:
            with self.subTest(path=path):
                response = self.request_workflow(path, ['Library', 'Broken'])
                self.assertEqual(response.status_code, 502)
                self.assertIn('Broken', response.json['error'])
        self.app.tmdb_service.find_gaps_for_movie.assert_not_called()
        self.app.tmdb_service.find_similar_movies.assert_not_called()
        self.app.tmdb_service.start_scan.assert_not_called()
        self.app.tvdb_service.find_gaps_for_show.assert_not_called()
        self.app.tvdb_service.start_scan.assert_not_called()

    def test_refresh_scan_does_not_reuse_stale_ownership_after_a_failure(self):
        for flag in ('freshScan', 'incremental'):
            with self.subTest(flag=flag):
                self.load_library('Broken', 'movie')
                self.media.movies_cache['Broken'] = {'movies': [{'tmdbId': 10}], 'tmdbIds': [10]}
                response = self.client.post('/api/recommendations/scan', json={
                    'libraryNames': ['Library', 'Broken'], flag: True,
                })
                self.assertEqual(response.status_code, 502)
        self.app.tmdb_service.start_scan.assert_not_called()

    @patch('app.services.schedule_service.config_store.put')
    def test_scheduled_partial_failures_do_not_persist_results_or_notify(self, put):
        scheduler = ScheduleService.__new__(ScheduleService)
        scheduler._app = self.app
        scheduler._record_last_run = Mock()
        scheduler._run_movie_scan(['Library', 'Broken'], 'plex')
        self.assertEqual(scheduler._record_last_run.call_args.kwargs['status'], 'error')
        scheduler._run_tv_scan(['Library', 'Broken'], 'plex')
        self.assertEqual(scheduler._record_last_run.call_args.kwargs['status'], 'error')
        self.app.tmdb_service.find_collection_gaps.assert_not_called()
        self.app.tmdb_service.persist_last_scan.assert_not_called()
        self.app.tvdb_service.find_franchise_gaps.assert_not_called()
        self.app.notification_service.notify_scan_results.assert_not_called()
        put.assert_not_called()


if __name__ == '__main__':
    unittest.main()
