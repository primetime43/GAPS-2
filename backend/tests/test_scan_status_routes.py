import unittest
from types import SimpleNamespace

from flask import Flask
from app.blueprints.recommendations import recommendations_bp
from app.blueprints.tvdb import tvdb_bp


class ScanStatusRouteTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(recommendations_bp, url_prefix='/recommendations')
        self.app.register_blueprint(tvdb_bp, url_prefix='/tvdb')
        self.progress = {
            'status': 'done', 'processed': 20, 'total': 20,
            'libraries': ['Library'], 'completed_at': '2026-09-24T12:00:00Z',
            'error': None, 'gaps': [{'name': 'Missing title', 'posterUrl': 'poster'}],
            'phase': 'titles',
        }
        self.app.tmdb_service = SimpleNamespace(scan_progress=self.progress)
        self.app.tvdb_service = SimpleNamespace(scan_progress=self.progress)
        self.client = self.app.test_client()

    def test_summary_omits_results_and_preserves_status_without_mutating_snapshot(self):
        for source in ('recommendations', 'tvdb'):
            with self.subTest(source=source):
                response = self.client.get(f'/{source}/scan/progress?summary=true')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, {key: value for key, value in self.progress.items() if key != 'gaps'})
                self.assertEqual(len(self.progress['gaps']), 1)

    def test_existing_progress_clients_still_receive_results(self):
        for source in ('recommendations', 'tvdb'):
            for query in ('', '?summary=false'):
                with self.subTest(source=source, query=query):
                    response = self.client.get(f'/{source}/scan/progress{query}')
                    self.assertEqual(response.json, self.progress)
