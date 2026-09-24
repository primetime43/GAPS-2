import unittest
from unittest.mock import Mock, patch

import requests
from flask import Flask

from app.blueprints.sonarr import sonarr_bp
from app.services.sonarr_service import SonarrService


class SonarrTagTests(unittest.TestCase):
    def setUp(self):
        self.saved = {
            'url': 'http://sonarr.test', 'api_key': 'key',
            'quality_profile_id': 1, 'root_folder_path': '/tv',
        }
        get = patch('app.services.sonarr_service.config_store.get',
                    side_effect=lambda key, default=None: self.saved.copy())
        put = patch('app.services.sonarr_service.config_store.put',
                    side_effect=lambda key, value: setattr(self, 'saved', value))
        get.start()
        self.put = put.start()
        self.addCleanup(get.stop)
        self.addCleanup(put.stop)
        self.service = SonarrService()
        app = Flask(__name__)
        app.register_blueprint(sonarr_bp, url_prefix='/api/sonarr')
        app.sonarr_service = self.service
        self.client = app.test_client()

    def test_legacy_config_defaults_to_no_tags(self):
        self.assertEqual(self.client.get('/api/sonarr/config').json['tags'], [])

    def test_tags_round_trip_deduplicated_and_can_be_cleared(self):
        response = self.client.post('/api/sonarr/config', json={
            **self.saved, 'api_key': '••••••', 'tags': [7, 2, 7],
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['tags'], [7, 2])
        self.assertEqual(self.saved['api_key'], 'key')
        self.assertEqual(self.client.get('/api/sonarr/config').json['tags'], [7, 2])
        self.client.post('/api/sonarr/config', json={**self.saved, 'tags': []})
        self.assertEqual(self.saved['tags'], [])

    def test_invalid_tag_ids_are_rejected_without_saving(self):
        for tags in (None, '7', 7, {}, [True], [0], [-1], [1.5], ['7']):
            with self.subTest(tags=tags):
                response = self.client.post('/api/sonarr/config', json={**self.saved, 'tags': tags})
                self.assertEqual(response.status_code, 400)
                self.assertIn('Tags', response.json['error'])
        self.put.assert_not_called()

    def test_tag_list_uses_sonarr_ids_and_labels(self):
        response = Mock()
        response.json.return_value = [{'id': 7, 'label': 'gaps', 'extra': 'ignored'}]
        with patch.object(self.service, '_request', return_value=response) as request:
            result = self.client.get('/api/sonarr/tags')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json, [{'id': 7, 'label': 'gaps'}])
        request.assert_called_once_with('GET', 'http://sonarr.test/api/v3/tag', 'key')
        response.raise_for_status.assert_called_once()

    def test_tag_list_without_configuration_is_empty(self):
        self.saved = {}
        with patch.object(self.service, '_request') as request:
            result = self.client.get('/api/sonarr/tags')
        self.assertEqual(result.json, [])
        request.assert_not_called()

    def test_tag_lookup_failure_returns_bad_gateway(self):
        with patch.object(self.service, '_request', side_effect=requests.ConnectionError('offline')):
            result = self.client.get('/api/sonarr/tags')
        self.assertEqual(result.status_code, 502)
        self.assertIn('offline', result.json['error'])

    def test_series_add_uses_saved_tag_ids(self):
        for tags in (None, [], [7, 2]):
            with self.subTest(tags=tags):
                if tags is not None:
                    self.saved['tags'] = tags
                lookup = Mock(status_code=200)
                lookup.json.return_value = {'title': 'Test', 'year': 2020}
                with patch.object(self.service, '_request', side_effect=[lookup, Mock(status_code=201)]) as request:
                    result = self.client.post('/api/sonarr/add', json={'tvdb_id': 123})
                self.assertEqual(result.status_code, 200)
                payload = request.call_args.kwargs['json']
                self.assertEqual(payload['tags'], tags or [])
                self.assertEqual(payload['rootFolderPath'], '/tv')

    def test_tags_preserve_series_metadata_and_existing_monitoring_preferences(self):
        self.saved.update(tags=[7], monitored=False, season_folder=False, search_on_add=False)
        lookup = Mock(status_code=200)
        seasons = [{'seasonNumber': 1, 'monitored': False}]
        lookup.json.return_value = [{'title': 'Test', 'titleSlug': 'test', 'seasons': seasons}]
        with patch.object(self.service, '_request', side_effect=[lookup, Mock(status_code=201)]) as request:
            result = self.client.post('/api/sonarr/add', json={'tvdb_id': 123})
        self.assertEqual(result.status_code, 200)
        self.assertIn('/tv', result.json['message'])
        payload = request.call_args.kwargs['json']
        self.assertEqual(payload['tags'], [7])
        self.assertEqual(payload['seasons'], seasons)
        self.assertEqual(payload['titleSlug'], 'test')
        self.assertFalse(payload['monitored'])
        self.assertFalse(payload['seasonFolder'])
        self.assertEqual(payload['addOptions'], {'monitor': 'none', 'searchForMissingEpisodes': False})
