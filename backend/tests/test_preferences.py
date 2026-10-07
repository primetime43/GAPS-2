import copy
import unittest
from unittest.mock import Mock, patch

from flask import Flask
from app.blueprints.preferences import preferences_bp


class PreferencesTests(unittest.TestCase):
    def setUp(self):
        self.saved = {'preferences': {
            'port': 9876, 'autoOpenBrowser': True,
            'language': 'fr', 'moviesPerPage': 100,
            'missingFilters': {'view': 'missing', 'sortBy': 'year'},
        }, 'imdb': {'enabled': True}}
        get = patch('app.blueprints.preferences.config_store.get',
                    side_effect=lambda key, default=None: copy.deepcopy(self.saved.get(key, default)))
        put = patch('app.blueprints.preferences.config_store.put',
                    side_effect=lambda key, value: self.saved.update({key: copy.deepcopy(value)}))
        get.start()
        self.put = put.start()
        self.addCleanup(get.stop)
        self.addCleanup(put.stop)
        app = Flask(__name__)
        app.register_blueprint(preferences_bp, url_prefix='/api/preferences')
        app.tmdb_service = Mock()
        self.client = app.test_client()

    def test_old_executable_settings_are_excluded_when_loading_preferences(self):
        response = self.client.get('/api/preferences')
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('port', response.json)
        self.assertNotIn('autoOpenBrowser', response.json)
        self.assertEqual(response.json['language'], 'fr')
        self.assertEqual(response.json['moviesPerPage'], 100)
        self.assertTrue(response.json['showImdbRatings'])
        self.put.assert_not_called()

    def test_saving_cleans_retired_keys_and_ignores_them_from_older_clients(self):
        response = self.client.post('/api/preferences', json={
            'port': 1111, 'autoOpenBrowser': False, 'moviesPerPage': 200,
        })
        self.assertEqual(response.status_code, 200)
        for prefs in [response.json, self.saved['preferences']]:
            self.assertNotIn('port', prefs)
            self.assertNotIn('autoOpenBrowser', prefs)
            self.assertEqual(prefs['moviesPerPage'], 200)
            self.assertEqual(prefs['language'], 'fr')
            self.assertEqual(prefs['missingFilters'], {'view': 'missing', 'sortBy': 'year'})


if __name__ == '__main__':
    unittest.main()
