import unittest
from unittest.mock import Mock, patch

import requests
from flask import Flask

from app.blueprints.sonarr import sonarr_bp
from app.services.sonarr_service import SonarrService


class SonarrRoutingTests(unittest.TestCase):
    def setUp(self):
        self.mapping = {
            'source': 'plex', 'server': 'Plex', 'library': 'TV',
            'root_folder_path': '/sonarr/tv',
        }
        self.saved = {
            'url': 'http://sonarr.test', 'api_key': 'key',
            'quality_profile_id': 1, 'root_folder_path': '/default',
            'library_root_folders': [self.mapping], 'tags': [7],
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
        self.app = Flask(__name__)
        self.app.register_blueprint(sonarr_bp, url_prefix='/api/sonarr')
        self.app.sonarr_service = self.service
        for source in ('plex', 'jellyfin', 'emby'):
            setattr(self.app, f'{source}_service', Mock(get_active_server=Mock(return_value=None)))
        self.client = self.app.test_client()
        self.context = {'source': 'plex', 'server': 'Plex', 'library_names': ['TV']}
        lookup = Mock(status_code=200)
        lookup.json.return_value = {'title': 'Test', 'year': 2020}
        self.service._request = Mock(side_effect=[lookup, Mock(status_code=201)])
        self.service.get_root_folders = Mock(return_value=[
            {'path': path, 'accessible': True} for path in ('/sonarr/tv', '/other', '/default')
        ])

    def add(self, **context):
        return self.client.post('/api/sonarr/add', json={'tvdb_id': 123, **context})

    def assert_destination(self, response, path):
        self.assertEqual(response.status_code, 200, response.json)
        payload = self.service._request.call_args.kwargs['json']
        self.assertEqual(payload['rootFolderPath'], path)
        self.assertEqual(payload['tags'], [7])

    def test_mapping_takes_precedence_over_default(self):
        self.assert_destination(self.add(**self.context), '/sonarr/tv')

    def test_explicit_destination_wins_over_conflicting_mappings(self):
        self.saved['library_root_folders'].append({**self.mapping, 'library': '4K', 'root_folder_path': '/other'})
        self.context['library_names'].append('4K')
        self.assert_destination(self.add(**self.context, root_folder_path='/default'), '/default')

    def test_same_root_for_multiple_libraries_routes_automatically(self):
        self.saved['library_root_folders'].append({**self.mapping, 'library': '4K'})
        self.context['library_names'] = ['TV', '4K', 'TV']
        self.assert_destination(self.add(**self.context), '/sonarr/tv')

    def test_conflicting_or_partially_mapped_libraries_do_not_add(self):
        for path in ('/other', None):
            with self.subTest(path=path):
                self.saved['library_root_folders'] = [self.mapping]
                if path:
                    self.saved['library_root_folders'].append({**self.mapping, 'library': '4K', 'root_folder_path': path})
                self.context['library_names'] = ['TV', '4K']
                response = self.add(**self.context)
                self.assertEqual(response.status_code, 400)
                self.assertIn('Choose a Sonarr destination', response.json['error'])
        self.service._request.assert_not_called()

    def test_unmapped_library_uses_default_folder(self):
        self.context['library_names'] = ['Unmapped']
        self.assert_destination(self.add(**self.context), '/default')

    def test_legacy_add_keeps_default_folder(self):
        self.assert_destination(self.add(), '/default')
        self.service.get_root_folders.assert_not_called()

    def test_mapping_is_scoped_to_source_and_server(self):
        self.context['server'] = 'Other Plex'
        self.context['source'] = 'jellyfin'
        self.assert_destination(self.add(**self.context), '/default')

    def test_mapping_works_without_a_default_root(self):
        self.saved['root_folder_path'] = ''
        self.assert_destination(self.add(**self.context), '/sonarr/tv')

    def test_missing_inaccessible_or_unverifiable_roots_do_not_add(self):
        for folders in ([], [{'path': '/sonarr/tv', 'accessible': False}]):
            with self.subTest(folders=folders):
                self.service.get_root_folders.return_value = folders
                response = self.add(**self.context)
                self.assertEqual(response.status_code, 400)
                self.assertIn('missing or inaccessible', response.json['error'])
        self.service.get_root_folders.side_effect = requests.ConnectionError('offline')
        response = self.add(**self.context)
        self.assertEqual(response.status_code, 400)
        self.assertIn('Could not verify', response.json['error'])
        self.service._request.assert_not_called()

    def test_arbitrary_explicit_path_is_rejected(self):
        response = self.add(root_folder_path='/not-a-sonarr-root')
        self.assertEqual(response.status_code, 400)
        self.service._request.assert_not_called()

    def test_invalid_context_is_rejected(self):
        for context in ({'library_names': 'TV'}, {'library_names': [3]},
                        {'library_names': ['TV']}, {'source': 'unknown'},
                        {'root_folder_path': []}, {'server': None}):
            with self.subTest(context=context):
                self.assertEqual(self.add(**context).status_code, 400)
        self.service._request.assert_not_called()

    def test_mappings_round_trip_and_can_be_removed(self):
        response = self.client.post('/api/sonarr/config', json=self.saved)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['library_root_folders'], [self.mapping])
        response = self.client.post('/api/sonarr/config', json={**self.saved, 'library_root_folders': []})
        self.assertEqual(response.json['library_root_folders'], [])

    def test_legacy_config_has_no_mappings(self):
        del self.saved['library_root_folders']
        self.assertEqual(self.client.get('/api/sonarr/config').json['library_root_folders'], [])

    def test_invalid_and_duplicate_mappings_are_rejected_without_saving(self):
        for mappings in (None, {}, ['TV'], [{}], [self.mapping, self.mapping],
                         [{**self.mapping, 'source': 'unknown'}],
                         [{**self.mapping, 'root_folder_path': ''}]):
            with self.subTest(mappings=mappings):
                response = self.client.post('/api/sonarr/config', json={**self.saved, 'library_root_folders': mappings})
                self.assertEqual(response.status_code, 400)
        self.put.assert_not_called()

    def test_library_discovery_includes_only_tv_libraries_without_credentials(self):
        self.app.plex_service.get_active_server.return_value = {
            'server': 'Plex', 'token': 'secret', 'serverUrl': 'http://private',
            'libraries': [{'title': 'TV', 'type': 'show'}, {'title': 'Movies', 'type': 'movie'}],
        }
        self.app.jellyfin_service.get_active_server.return_value = {
            'server': 'Jellyfin', 'libraries': [{'title': 'TV', 'type': 'tvshows'}],
        }
        self.assertEqual(self.client.get('/api/sonarr/libraries').json, [
            {'source': 'plex', 'server': 'Plex', 'library': 'TV'},
            {'source': 'jellyfin', 'server': 'Jellyfin', 'library': 'TV'},
        ])
