import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from flask import Flask

from app.blueprints.libraries import libraries_bp, _image_cache, _poster_session
from app.services.poster_urls import poster_url, POSTER_HEIGHT, POSTER_WIDTH


class PosterLoadingTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(libraries_bp, url_prefix='/api/libraries')
        self.active = {'serverUrl': 'http://plex.test:32400', 'token': 'secret-token'}
        self.app.plex_service = Mock()
        self.app.plex_service.get_active_server.return_value = self.active
        self.client = self.app.test_client()
        self.thumb = '/library/metadata/42/thumb/1234'
        self.url = poster_url('plex', self.active['serverUrl'], self.active['token'], thumb=self.thumb)
        self.session = Mock()
        patcher = patch('app.blueprints.libraries._poster_session', return_value=self.session)
        patcher.start()
        self.addCleanup(patcher.stop)
        prefs = patch('app.services.config_store.get', return_value={'imageCacheEnabled': False})
        prefs.start()
        self.addCleanup(prefs.stop)
        _image_cache.clear()
        self.addCleanup(_image_cache.clear)

    def upstream(self, content=b'poster', status=200):
        result = Mock(status_code=status, content=content, headers={'Content-Type': 'image/jpeg'})
        result.iter_content.return_value = iter([content])
        return result

    def test_plex_requests_a_small_thumbnail_and_allows_private_browser_reuse(self):
        upstream = self.upstream()
        self.session.get.return_value = upstream
        response = self.client.get(self.url)
        self.assertEqual(response.data, b'poster')
        self.assertEqual(response.headers['Cache-Control'], 'private, max-age=3600')
        call = self.session.get.call_args
        target = urlsplit(call.args[0])
        self.assertEqual(target.path, '/photo/:/transcode')
        query = parse_qs(target.query)
        self.assertEqual(query['width'], [str(POSTER_WIDTH)])
        self.assertEqual(query['height'], [str(POSTER_HEIGHT)])
        self.assertEqual(query['url'], [self.thumb])
        self.assertEqual(call.kwargs['headers'], {'X-Plex-Token': 'secret-token'})
        self.assertNotIn('secret-token', self.url)
        self.assertNotIn('secret-token', call.args[0])
        upstream.close.assert_called_once()

    def test_rejected_resize_falls_back_to_original_and_closes_both_responses(self):
        rejected, original = self.upstream(status=400), self.upstream()
        self.session.get.side_effect = [rejected, original]
        self.assertEqual(self.client.get(self.url).data, b'poster')
        self.assertEqual(self.session.get.call_args.args[0], self.active['serverUrl'] + self.thumb)
        rejected.close.assert_called_once()
        original.close.assert_called_once()

    def test_stale_connection_version_does_not_fetch_or_cache_another_servers_art(self):
        self.active['token'] = 'new-token'
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.session.get.assert_not_called()
        self.assertNotEqual(self.url, poster_url('plex', self.active['serverUrl'], self.active['token'], thumb=self.thumb))

    def test_image_versions_change_with_server_and_artwork(self):
        self.assertNotEqual(self.url, poster_url('plex', 'http://other.test', 'secret-token', thumb=self.thumb))
        self.assertNotEqual(self.url, poster_url('plex', self.active['serverUrl'], 'secret-token', thumb=self.thumb + '5'))
        first = poster_url('jellyfin', 'http://server.test', 'key', item_id='42', image_tag='first')
        second = poster_url('jellyfin', 'http://server.test', 'key', item_id='42', image_tag='second')
        self.assertNotEqual(first, second)

    def test_legacy_urls_keep_revalidation_and_failed_images_are_not_cached(self):
        self.session.get.return_value = self.upstream()
        response = self.client.get('/api/libraries/image-proxy', query_string={'source': 'plex', 'thumb': self.thumb})
        self.assertEqual(response.data, b'poster')
        self.assertEqual(response.headers['Cache-Control'], 'private, no-cache')
        self.session.get.return_value = self.upstream(status=404)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_upstream_connections_are_reused_on_the_same_worker(self):
        # The imported function is the real implementation, not the route mock.
        self.assertIs(_poster_session(), _poster_session())


if __name__ == '__main__':
    unittest.main()
