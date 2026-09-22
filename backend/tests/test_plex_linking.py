import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.plex import plex_bp
from app.services.plex_service import PlexService


class PlexLinkingTests(unittest.TestCase):
    def setUp(self):
        reader = patch('app.services.plex_service.config_store.get', return_value={})
        reader.start()
        self.addCleanup(reader.stop)
        writer = patch('app.services.plex_service.config_store.put')
        self.persist = writer.start()
        self.addCleanup(writer.stop)
        self.service = PlexService()
        self.service._token = 'test-token'
        self.service._resources = {'NAS': {'connections': [{'uri': 'http://nas:32400', 'local': True}]}}
        self.server = Mock(_baseurl='http://nas:32400')
        self.server.library.sections.return_value = [
            Mock(title='Movies', type='movie'), Mock(title='TV Shows', type='show'),
            Mock(title='Music', type='artist'),
        ]

    @patch('app.services.plex_service.PlexServer')
    def test_selected_connection_discovers_all_library_types(self, direct):
        direct.return_value = self.server
        self.service._server_conn = Mock()
        self.service._server_conn_name = 'NAS'
        libraries, token, error = self.service.fetch_libraries('NAS', 'http://nas:32400')
        direct.assert_called_once_with('http://nas:32400', 'test-token', timeout=30)
        self.assertEqual([lib['type'] for lib in libraries], ['movie', 'show', 'artist'])
        self.assertEqual(token, 'test-token')
        self.assertIsNone(error)

    @patch('app.services.plex_service.PlexServer')
    def test_unlisted_connection_is_rejected(self, direct):
        libraries, _, error = self.service.fetch_libraries('NAS', 'http://other:32400')
        self.assertIsNone(libraries)
        self.assertIn('listed', error)
        direct.assert_not_called()

    def test_offline_server_does_not_claim_saved_libraries_are_live(self):
        self.service._active_server = {'server': 'NAS', 'libraries': [{'title': 'Old TV', 'type': 'show'}]}
        self.service._get_server = Mock(return_value=None)
        self.assertEqual(self.service.fetch_libraries('NAS'), (None, None, 'Server not found'))

    def test_library_access_error_is_a_failed_connection(self):
        self.service._get_server = Mock(return_value=self.server)
        self.server.library.sections.side_effect = RuntimeError('Forbidden')
        libraries, token, error = self.service.fetch_libraries('NAS')
        self.assertIsNone(libraries)
        self.assertIsNone(token)
        self.assertIn('Could not load libraries', error)
        self.assertIsNone(self.service._server_conn)

    def test_auto_connection_saves_the_working_url_and_tv_libraries(self):
        self.service._get_server = Mock(return_value=self.server)
        libraries, token, _ = self.service.fetch_libraries('NAS')
        self.assertEqual(self.service.save_active_server('NAS', token, libraries), (True, None))
        saved = self.persist.call_args.args[1]['active_server']
        self.assertEqual(saved['serverUrl'], 'http://nas:32400')
        self.assertIn({'title': 'TV Shows', 'type': 'show'}, saved['libraries'])

    def test_refresh_persists_new_tv_libraries(self):
        self.service._active_server = {'server': 'NAS', 'libraries': []}
        self.service._get_server = Mock(return_value=self.server)
        ok, error, libraries = self.service.refresh_connection()
        self.assertTrue(ok)
        self.assertIsNone(error)
        self.assertEqual(libraries, self.persist.call_args.args[1]['active_server']['libraries'])
        self.assertIn({'title': 'TV Shows', 'type': 'show'}, libraries)

    def test_route_passes_selected_connection_and_rejects_empty_save(self):
        app = Flask(__name__)
        app.plex_service = self.service
        app.register_blueprint(plex_bp, url_prefix='/api/plex')
        self.service.fetch_libraries = Mock(return_value=([], 'test-token', None))
        client = app.test_client()
        response = client.get('/api/plex/libraries/NAS', query_string={'serverUrl': 'http://nas:32400'})
        self.assertEqual(response.status_code, 200)
        self.service.fetch_libraries.assert_called_once_with('NAS', 'http://nas:32400')
        self.assertEqual(client.post('/api/plex/save-data', json={}).status_code, 400)
        self.persist.assert_not_called()


if __name__ == '__main__':
    unittest.main()
