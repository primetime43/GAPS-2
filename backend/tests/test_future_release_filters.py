import unittest
from unittest.mock import patch

from app.services import scan_history


class FutureReleaseFilterTests(unittest.TestCase):
    def test_release_date_takes_precedence_over_year(self):
        for release_date, year, expected in [
            ('2000-01-01', '2099', False),
            ('2026-10-01', 'N/A', False),
            ('2099-01-01', '2000', True),
        ]:
            with self.subTest(release_date=release_date):
                self.assertEqual(scan_history._is_future_release(
                    {'releaseDate': release_date, 'year': year}, '2026-10-01', 2026,
                ), expected)

    def test_missing_dates_fall_back_to_year_or_count_as_unreleased(self):
        for year, expected in [
            ('2000', False), (2026, False), ('2099', True),
            ('N/A', True), ('', True), (None, True), (0, True),
        ]:
            for release_date in ['', None]:
                with self.subTest(year=year, release_date=release_date):
                    self.assertEqual(scan_history._is_future_release(
                        {'releaseDate': release_date, 'year': year}, '2026-10-01', 2026,
                    ), expected)
        self.assertTrue(scan_history._is_future_release({}, '2026-10-01', 2026))

    @patch('app.services.scan_history.config_store.get')
    def test_actionable_counts_respect_future_release_preference(self, get):
        for media_type, id_key in [('movie', 'tmdbId'), ('tv', 'tvdbId')]:
            gaps = [
                {id_key: 1, 'year': '2000'},
                {id_key: 2, 'year': '2099', 'releaseDate': '2099-01-01'},
                {id_key: 3, 'year': 'N/A', 'releaseDate': ''},
                {id_key: 4},
                {id_key: 5, 'year': '2000'},
            ]
            for hide_future, expected in [(True, [1]), (False, [1, 2, 3, 4])]:
                with self.subTest(media_type=media_type, hide_future=hide_future):
                    config = {
                        'preferences': {'hideFutureReleasesByDefault': hide_future},
                        'ignored_movies': [5],
                        'ignored_shows': [5],
                    }
                    get.side_effect = lambda key, default=None: config.get(key, default)
                    result = scan_history.actionable_missing(media_type, gaps)
                    self.assertEqual([g[id_key] for g in result], expected)


if __name__ == '__main__':
    unittest.main()
