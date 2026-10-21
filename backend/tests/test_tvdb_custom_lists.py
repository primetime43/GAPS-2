import tempfile
import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.tvdb import tvdb_bp
from app.services.tvdb_service import TvdbService


def series(name, lists=None):
    return {'name': name, 'firstAired': '2000-01-01', 'year': '2000', 'lists': lists or []}


class TvdbCustomListsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        with patch('app.services.tvdb_service.config_store.data_dir', return_value=self.temp.name), \
                patch('app.services.scan_progress.config_store.get', return_value=None):
            self.service = TvdbService('https://api4.thetvdb.com/v4')
        self.addCleanup(self.service._session.close)
        self.service._request = Mock()
        self.custom = {'id': 17543, 'name': 'Digimon', 'score': 100, 'isOfficial': False}
        self.service._series_cache = {
            72241: series('Digimon Adventure', [self.custom]),
            2: series('Digimon Tamers'),
            3: series('Digimon Frontier'),
        }
        self.service._list_cache = {
            17543: {'name': 'Digimon', 'series': [72241, 2, 3]},
        }

    def test_custom_lists_are_ranked_deduplicated_and_limited_to_25(self):
        lists = [dict(self.custom, id=n, name=f'List {n}', score=n) for n in range(1, 31)]
        lists.append(lists[-1])
        self.service._series_cache[72241]['lists'] = lists
        choices, error = self.service.get_lists_for_show(72241)
        self.assertIsNone(error)
        self.assertFalse(choices['hasOfficialList'])
        self.assertEqual([lst['id'] for lst in choices['customLists']], list(range(30, 5, -1)))
        self.assertEqual(choices['customLists'][0]['url'], 'https://thetvdb.com/lists/30')
        self.service._request.assert_not_called()

    def test_custom_lists_require_explicit_selection_and_respect_ownership(self):
        gaps, error = self.service.find_gaps_for_show(72241, {72241, 2})
        self.assertEqual(gaps, [])
        self.assertIsNone(error)
        gaps, error = self.service.find_gaps_for_show(72241, {72241, 2}, list_id=17543)
        self.assertIsNone(error)
        self.assertEqual([g['tvdbId'] for g in gaps], [3])
        self.assertEqual(gaps[0]['franchiseName'], 'Digimon')
        gaps, error = self.service.find_gaps_for_show(72241, {72241, 2}, True, list_id=17543)
        self.assertIsNone(error)
        self.assertEqual({g['tvdbId']: g['owned'] for g in gaps}, {72241: True, 2: True, 3: False})

    def test_official_lists_take_precedence_and_all_official_lists_are_scanned(self):
        official = dict(self.custom, id=10, isOfficial=True)
        other = dict(official, id=11)
        self.service._series_cache[72241]['lists'] = [self.custom, official, other, official]
        self.service._list_cache[10] = {'name': 'Official A', 'series': [72241, 2]}
        self.service._list_cache[11] = {'name': 'Official B', 'series': [72241, 3]}
        choices, error = self.service.get_lists_for_show(72241)
        self.assertEqual(choices, {'hasOfficialList': True, 'customLists': []})
        gaps, error = self.service.find_gaps_for_show(72241, {72241})
        self.assertIsNone(error)
        self.assertEqual({g['tvdbId'] for g in gaps}, {2, 3})
        self.assertEqual(len(gaps), 2)
        gaps, error = self.service.find_gaps_for_show(72241, {72241}, list_id=17543)
        self.assertIsNone(gaps)
        self.assertIn('available custom lists', error)

    def test_invalid_unavailable_and_stale_list_selections_report_errors(self):
        gaps, error = self.service.find_gaps_for_show(72241, {72241}, list_id=999)
        self.assertIsNone(gaps)
        self.assertIn('available custom lists', error)
        self.service._request.assert_not_called()
        self.service._list_cache.clear()
        self.service._request.return_value = None
        gaps, error = self.service.find_gaps_for_show(72241, {72241}, list_id=17543)
        self.assertIsNone(gaps)
        self.assertIn('Could not load the selected', error)
        self.service._list_cache[17543] = {'name': 'Stale list', 'series': [2, 3]}
        gaps, error = self.service.find_gaps_for_show(72241, {72241}, list_id=17543)
        self.assertIsNone(gaps)
        self.assertIn('no longer contains', error)

    def test_missing_show_and_no_lists_are_distinct(self):
        self.service._request.return_value = None
        choices, error = self.service.get_lists_for_show(999)
        self.assertIsNone(choices)
        self.assertIn('Could not load', error)
        choices, error = self.service.get_lists_for_show(2)
        self.assertIsNone(error)
        self.assertEqual(choices, {'hasOfficialList': False, 'customLists': []})

    def test_old_cache_is_refreshed_once_to_preserve_popularity_scores(self):
        del self.service._series_cache[72241]['lists'][0]['score']
        self.service._request.return_value = Mock(status_code=200)
        self.service._request.return_value.json.return_value = {
            'data': dict(series('Digimon'), lists=[dict(self.custom, score=25)])}
        choices, error = self.service.get_lists_for_show(72241)
        self.assertIsNone(error)
        self.assertEqual(choices['customLists'][0]['id'], 17543)
        self.assertEqual(self.service._series_cache[72241]['lists'][0]['score'], 25)
        self.service.get_lists_for_show(72241)
        self.service._request.assert_called_once()
        self.service._save_cache()
        with patch('app.services.tvdb_service.config_store.data_dir', return_value=self.temp.name), \
                patch('app.services.scan_progress.config_store.get', return_value=None):
            reloaded = TvdbService('https://api4.thetvdb.com/v4')
        self.addCleanup(reloaded._session.close)
        self.assertEqual(reloaded._series_cache[72241]['lists'][0]['score'], 25)

    def test_mixed_list_includes_only_unique_tv_series(self):
        self.service._request.return_value = Mock(status_code=200)
        self.service._request.return_value.json.return_value = {'data': {
            'name': 'Mixed list', 'entities': [
                {'seriesId': 72241}, {'movieId': 99}, {'seriesId': 2},
                {'seriesId': 2}, {'seriesId': 0}, {'seriesId': None},
            ]}}
        members = self.service._get_list_members(123)
        self.assertEqual(members['series'], [72241, 2])

    def test_full_scans_do_not_automatically_choose_custom_lists(self):
        gaps = self.service.find_franchise_gaps([{'tvdbId': 72241}], {72241})
        self.assertEqual(gaps, [])
        self.service._request.assert_not_called()


class TvdbCustomListRouteTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(tvdb_bp, url_prefix='/api/tvdb')
        app.tvdb_service = self.service = Mock(is_configured=True)
        self.choices = {'hasOfficialList': False, 'customLists': [
            {'id': 17543, 'name': 'Digimon', 'url': 'https://thetvdb.com/lists/17543'}]}
        self.service.get_lists_for_show.return_value = (self.choices, None)
        self.service.find_gaps_for_show.return_value = ([], None)
        app.jellyfin_service = Mock(shows_cache={
            'Anime': {'shows': [], 'tvdbIds': [72241]},
            'TV': {'shows': [], 'tvdbIds': [2]},
        })
        self.client = app.test_client()

    def test_response_contains_list_choices_and_selected_library_ownership(self):
        response = self.client.get('/api/tvdb/show', query_string={
            'tvdbId': 72241, 'listId': 17543, 'libraryNames': ['Anime', 'TV'],
            'source': 'jellyfin', 'showExisting': 'true',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, dict(self.choices, gaps=[]))
        self.service.find_gaps_for_show.assert_called_once_with(72241, {72241, 2}, True, list_id=17543)

    def test_invalid_list_ids_are_rejected_before_loading_libraries(self):
        for value in ('', '0', '-1', 'abc', '1.5', '999'):
            with self.subTest(value=value):
                response = self.client.get('/api/tvdb/show', query_string={'tvdbId': 72241, 'listId': value})
                self.assertEqual(response.status_code, 400)
        self.service.find_gaps_for_show.assert_not_called()

    def test_upstream_show_failure_is_not_reported_as_no_lists(self):
        self.service.get_lists_for_show.return_value = (None, 'Could not load this show from TheTVDB')
        response = self.client.get('/api/tvdb/show?tvdbId=72241')
        self.assertEqual(response.status_code, 502)
        self.assertIn('Could not load', response.json['error'])


if __name__ == '__main__':
    unittest.main()
