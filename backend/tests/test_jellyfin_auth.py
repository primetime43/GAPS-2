"""Regression coverage for Jellyfin 12's removal of legacy token headers."""

import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.jellyfin import jellyfin_bp
from app.blueprints.libraries import libraries_bp
from app.services.emby_service import EmbyService
from app.services.jellyfin_service import JellyfinService


class JellyfinAuthTests(unittest.TestCase):
    def setUp(self):
        # Never read or write the developer's saved server credentials.
        config = patch('app.services.config_store.get', return_value={})
        self.config_get = config.start()
        self.addCleanup(config.stop)
        self.service = JellyfinService()
        self.service._server_url = 'http://jellyfin.test/jellyfin'
        self.service._api_key = 'saved-key'
        self.headers = {'Authorization': 'MediaBrowser Token="saved-key"'}
        self.app = Flask(__name__)
        self.app.jellyfin_service = self.service
        self.app.register_blueprint(jellyfin_bp, url_prefix='/api/jellyfin')
        self.app.register_blueprint(libraries_bp, url_prefix='/api/libraries')
        self.client = self.app.test_client()

    @staticmethod
    def response(data, status=200):
        return Mock(status_code=status, json=Mock(return_value=data))

    @patch('app.services.jellyfin_service.requests.get')
    def test_connection_uses_supplied_key_without_changing_saved_connection(self, get):
        get.return_value = self.response({'ServerName': 'New server'})
        result = self.service.test_connection('http://new.test/base/', 'new-key')
        self.assertEqual(result, (True, 'New server'))
        get.assert_called_once_with(
            'http://new.test/base/System/Info',
            headers={'Authorization': 'MediaBrowser Token="new-key"'}, timeout=10,
        )
        self.assertEqual(self.service._api_key, 'saved-key')
        self.assertEqual(self.service._server_url, 'http://jellyfin.test/jellyfin')

    @patch('app.services.jellyfin_service.requests.get')
    def test_invalid_key_is_still_rejected(self, get):
        get.return_value = self.response({}, status=401)
        self.assertEqual(self.service.test_active_connection(), (False, None))
        self.assertEqual(get.call_args.kwargs['headers'], self.headers)

    @patch('app.services.jellyfin_service.requests.get')
    def test_connect_discovers_users_and_libraries_with_modern_auth(self, get):
        def server(url, headers, **kwargs):
            # Model a server with legacy authorization disabled.
            if headers != self.headers:
                return self.response({}, status=401)
            if url.endswith('/System/Info'):
                return self.response({'ServerName': 'Jellyfin 12'})
            if url.endswith('/Users'):
                return self.response([{'Id': 'user-id'}])
            if url.endswith('/Users/user-id/Views'):
                return self.response({'Items': [
                    {'Id': 'movies', 'Name': 'Movies', 'CollectionType': 'movies'},
                ]})
            self.fail(f'Unexpected URL: {url}')

        get.side_effect = server
        response = self.client.post('/api/jellyfin/connect', json={
            'serverUrl': 'http://jellyfin.test/jellyfin/', 'apiKey': 'saved-key',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {
            'connected': True, 'serverName': 'Jellyfin 12',
            'libraries': [{'title': 'Movies', 'type': 'movie', 'id': 'movies'}],
        })
        self.assertEqual(get.call_count, 3)

    @patch('app.services.jellyfin_service.requests.get')
    def test_restored_connection_uses_modern_auth_for_virtual_folders(self, get):
        self.config_get.return_value = {
            'server_url': 'http://jellyfin.test/jellyfin', 'api_key': 'saved-key',
        }
        service = JellyfinService()
        get.return_value = self.response([
            {'ItemId': 'movies', 'Name': 'Movies', 'CollectionType': 'movies'},
        ])
        libraries, error = service.fetch_libraries()
        self.assertIsNone(error)
        self.assertEqual(libraries[0]['id'], 'movies')
        get.assert_called_once_with(
            'http://jellyfin.test/jellyfin/Library/VirtualFolders',
            headers=self.headers, timeout=10,
        )

    @patch('app.services.jellyfin_service.requests.get')
    def test_movies_and_shows_authenticate_every_page(self, get):
        self.service._libraries_cache = [{'title': 'Library', 'id': 'library-id'}]
        for method in (self.service.get_movies, self.service.get_shows):
            for user_id in (None, 'user-id'):
                with self.subTest(method=method.__name__, user_id=user_id):
                    self.service.clear_movies_cache()
                    self.service.clear_shows_cache()
                    self.service._user_id = user_id
                    get.reset_mock()
                    get.side_effect = [
                        self.response({'Items': [{'Name': 'First'}], 'TotalRecordCount': 2}),
                        self.response({'Items': [{'Name': 'Second'}], 'TotalRecordCount': 2}),
                    ]
                    items, error = method('Library')
                    self.assertIsNone(error)
                    self.assertEqual([item['name'] for item in items], ['First', 'Second'])
                    self.assertEqual(get.call_count, 2)
                    for index, call in enumerate(get.call_args_list):
                        self.assertEqual(call.kwargs['headers'], self.headers)
                        self.assertEqual(call.kwargs['params']['StartIndex'], str(index))

    @patch('app.blueprints.libraries._poster_session')
    def test_poster_proxy_uses_each_servers_auth(self, session):
        get = session.return_value.get
        emby = EmbyService()
        emby._server_url = 'http://emby.test'
        emby._api_key = 'emby-key'
        self.app.emby_service = emby
        for source, headers in (
            ('jellyfin', self.headers), ('emby', {'X-Emby-Token': 'emby-key'}),
        ):
            with self.subTest(source=source):
                upstream = self.response({})
                upstream.headers = {'Content-Type': 'image/jpeg'}
                upstream.iter_content.return_value = iter([b'poster'])
                get.return_value = upstream
                response = self.client.get(
                    f'/api/libraries/image-proxy?source={source}&itemId=movie-id',
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, b'poster')
                self.assertEqual(get.call_args.kwargs['headers'], headers)
                self.assertNotIn('key', get.call_args.args[0])
                upstream.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
