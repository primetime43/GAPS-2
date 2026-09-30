import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.jellyfin import jellyfin_bp
from app.blueprints.emby import emby_bp
from app.blueprints.libraries import libraries_bp, _image_cache
from app.services.jellyfin_service import JellyfinService
from app.services.emby_service import EmbyService
from app.services.plex_service import PlexService


class ConnectionCacheTests(unittest.TestCase):
    def setUp(self):
        for name in ('get', 'put'):
            patcher = patch(f'app.services.config_store.{name}', return_value={})
            patcher.start()
            self.addCleanup(patcher.stop)

    def seed(self, service):
        service._movies_cache = {'Movies': {'movies': [{'name': 'Old movie'}]}}
        service._shows_cache = {'TV': {'shows': [{'name': 'Old show'}]}}

    def test_saving_any_media_server_invalidates_owned_library_caches(self):
        for cls in (JellyfinService, EmbyService, PlexService):
            with self.subTest(server=cls.__name__):
                service = cls()
                self.seed(service)
                if cls is PlexService:
                    service._server_conn = Mock()
                    service.save_active_server('New', 'key', [], 'http://new.test')
                    self.assertIsNone(service._server_conn)
                else:
                    service._user_id = 'old-user'
                    service.save_active_server('http://new.test', 'key', 'New', [])
                    self.assertIsNone(service._user_id)
                self.assertEqual(service.movies_cache, {})
                self.assertEqual(service.shows_cache, {})

    def test_reconnect_without_user_discovery_drops_old_user_and_media(self):
        for cls in (JellyfinService, EmbyService):
            with self.subTest(server=cls.__name__), patch('requests.get', return_value=Mock(status_code=403)):
                service = cls()
                self.seed(service)
                service._user_id = 'old-user'
                service.test_connection = Mock(return_value=(True, 'New'))
                self.assertTrue(service.connect('http://new.test', 'key')[0])
                self.assertIsNone(service._user_id)
                self.assertEqual(service.movies_cache, {})
                self.assertEqual(service.shows_cache, {})

    @patch('app.services.plex_service.PlexServer')
    @patch('app.services.plex_service.MyPlexAccount')
    def test_plex_selection_does_not_connect_to_the_previous_servers_url(self, account, direct):
        service = PlexService()
        service._token = 'key'
        service._active_server = {'server': 'Old', 'serverUrl': 'http://old.test', 'libraries': ['Old library']}
        new_server = Mock(_baseurl='http://new.test')
        account.return_value.resource.return_value.connect.return_value = new_server
        self.assertIs(service._get_server('New'), new_server)
        direct.assert_not_called()
        self.assertEqual(service._active_server['serverUrl'], 'http://old.test')
        service._get_server = Mock(return_value=None)
        self.assertEqual(service.fetch_libraries('New'), (None, None, 'Server not found'))

    def test_library_discovery_failure_is_not_reported_as_a_successful_connection(self):
        app = Flask(__name__)
        app.register_blueprint(jellyfin_bp, url_prefix='/api/jellyfin')
        app.register_blueprint(emby_bp, url_prefix='/api/emby')
        for source in ('jellyfin', 'emby'):
            with self.subTest(source=source):
                service = Mock()
                service.connect.return_value = (True, 'Server', None)
                service.fetch_libraries.return_value = (None, 'HTTP 403')
                setattr(app, f'{source}_service', service)
                response = app.test_client().post(f'/api/{source}/connect', json={'serverUrl': 'http://test', 'apiKey': 'key'})
                self.assertEqual(response.status_code, 502)
                self.assertFalse(response.json['connected'])


class PosterCacheTests(unittest.TestCase):
    @patch('app.blueprints.libraries._poster_session')
    @patch('app.services.config_store.get', return_value={'imageCacheEnabled': True})
    def test_artwork_cache_is_scoped_to_server_and_credentials(self, config_get, session):
        get = session.return_value.get
        _image_cache.clear()
        self.addCleanup(_image_cache.clear)
        app = Flask(__name__)
        app.register_blueprint(libraries_bp, url_prefix='/api/libraries')
        service = JellyfinService()
        app.jellyfin_service = service
        service._server_url = 'http://first.test'
        service._api_key = 'first-key'
        client = app.test_client()
        first = Mock(status_code=200, content=b'first', headers={'Content-Type': 'image/jpeg'})
        second = Mock(status_code=200, content=b'second', headers={'Content-Type': 'image/jpeg'})
        third = Mock(status_code=200, content=b'third', headers={'Content-Type': 'image/jpeg'})
        get.side_effect = [first, second, third]
        url = '/api/libraries/image-proxy?source=jellyfin&itemId=same-id'
        self.assertEqual(client.get(url).data, b'first')
        self.assertEqual(client.get(url).data, b'first')
        self.assertEqual(get.call_count, 1)
        service._server_url = 'http://second.test'
        self.assertEqual(client.get(url).data, b'second')
        service._api_key = 'new-key'
        response = client.get(url)
        self.assertEqual(response.data, b'third')
        self.assertIn('no-cache', response.headers['Cache-Control'])
        for upstream in (first, second, third):
            upstream.close.assert_called_once()
        service._server_url = None
        self.assertEqual(client.get(url).status_code, 404)


if __name__ == '__main__':
    unittest.main()
