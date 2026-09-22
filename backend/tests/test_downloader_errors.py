import unittest
from unittest.mock import Mock, patch

import requests

from app.services.radarr_service import RadarrService
from app.services.sonarr_service import SonarrService


class DownloaderErrorTests(unittest.TestCase):
    def add_with_error(self, cls, message, present=False, unavailable=False):
        service = cls()
        service._get_url_key = Mock(return_value=('http://test', 'key'))
        service.get_config = Mock(return_value={
            'quality_profile_id': 1, 'root_folder_path': '/media',
            'monitored': True, 'search_on_add': False,
            'minimum_availability': 'released', 'auto_route_by_decade': False,
            'season_folder': True,
        })
        lookup = Mock(status_code=200)
        lookup.json.return_value = {'title': 'Test', 'year': 2020}
        rejected = Mock(status_code=400)
        rejected.json.return_value = [{'errorMessage': message}]
        service._request = Mock(side_effect=[lookup, rejected])
        library_method = 'get_library_tmdb_ids' if cls is RadarrService else 'get_library_tvdb_ids'
        with patch.object(service, library_method, return_value=[123] if present else []) as library:
            if unavailable:
                library.side_effect = requests.ConnectionError('offline')
            add = service.add_movie if cls is RadarrService else service.add_series
            return add(123)

    def test_existing_folder_is_not_reported_as_a_successful_add(self):
        for cls in (RadarrService, SonarrService):
            with self.subTest(service=cls.__name__):
                ok, message = self.add_with_error(cls, 'This path is already configured for another title')
                self.assertFalse(ok)
                self.assertIn('path', message)

    def test_existing_title_is_success_only_when_confirmed_in_library(self):
        for cls in (RadarrService, SonarrService):
            with self.subTest(service=cls.__name__):
                self.assertTrue(self.add_with_error(cls, 'Title already exists', present=True)[0])
                self.assertFalse(self.add_with_error(cls, 'Title already exists', unavailable=True)[0])
