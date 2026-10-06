import unittest
from unittest.mock import Mock

from flask import Flask
from requests.exceptions import Timeout

from app.blueprints.recommendations import recommendations_bp
from app.services.tmdb_service import TmdbService


class SimilarMoviesTests(unittest.TestCase):
    def setUp(self):
        self.service = TmdbService.__new__(TmdbService)
        self.service._base_url = 'https://api.themoviedb.org/3'
        self.service._image_base_url = 'https://image.tmdb.org/t/p/w500'
        self.service._language = 'en'
        self.service._session = Mock()

    @staticmethod
    def response(results, pages=1, status=200):
        return Mock(status_code=status, json=Mock(return_value={
            'results': results, 'total_pages': pages,
        }))

    def test_recommendations_keep_provider_order_and_ownership_across_pages(self):
        # Fixture order is deliberately different from title, year and rating order.
        self.service._session.get.side_effect = [
            self.response([
                {'id': 10072, 'title': 'Seed movie'},
                {'id': 3, 'title': 'Z title', 'release_date': '1987-01-01',
                 'vote_average': 6, 'vote_count': 100},
                {'id': 1, 'title': 'A title', 'release_date': '2001-01-01',
                 'vote_average': 9, 'vote_count': 200},
            ], pages=2),
            self.response([
                {'id': 3, 'title': 'Duplicate'},
                {'id': 2, 'title': 'Other title', 'release_date': '2020-01-01'},
            ], pages=2),
        ]

        movies, error = self.service.find_similar_movies(
            'test-key', 10072, {3}, {'a title|2001'},
        )

        self.assertIsNone(error)
        self.assertEqual([movie['tmdbId'] for movie in movies], [3, 1, 2])
        self.assertEqual([movie['owned'] for movie in movies], [True, True, False])
        self.assertEqual(movies[0]['voteAverage'], 6)
        self.assertEqual(movies[0]['voteCount'], 100)
        calls = self.service._session.get.call_args_list
        self.assertEqual(len(calls), 2)
        for page, call in enumerate(calls, start=1):
            self.assertEqual(call.args[0], 'https://api.themoviedb.org/3/movie/10072/recommendations')
            self.assertEqual(call.kwargs['params'], {
                'api_key': 'test-key', 'language': 'en', 'page': page,
            })

    def test_empty_recommendations_do_not_fall_back_to_loose_similar_matches(self):
        self.service._session.get.return_value = self.response([])
        self.assertEqual(self.service.find_similar_movies('test-key', 10072, set()), ([], None))
        self.service._session.get.assert_called_once()

    def test_recommendation_failure_is_reported_without_switching_sources(self):
        self.service._session.get.return_value = self.response([], status=503)
        movies, error = self.service.find_similar_movies('test-key', 10072, set())
        self.assertIsNone(movies)
        self.assertIn('503', error)
        self.service._session.get.assert_called_once()

    def test_tv_recommendations_use_series_names_and_first_air_dates(self):
        self.service._session.get.side_effect = [
            self.response([
                {'id': 100, 'name': 'Seed'},
                {'id': 2, 'name': 'Series', 'first_air_date': '2020-05-01',
                 'vote_average': 8.4, 'vote_count': 200},
            ], pages=2),
            self.response([
                {'id': 2, 'name': 'Duplicate'},
                {'id': 3, 'name': 'Unknown date'},
            ], pages=2),
        ]
        rows, error = self.service.find_similar_shows('key', 100, set(), {'series|2020'})
        self.assertIsNone(error)
        self.assertEqual([row['tmdbId'] for row in rows], [2, 3])
        self.assertEqual(rows[0]['name'], 'Series')
        self.assertEqual(rows[0]['year'], '2020')
        self.assertEqual(rows[0]['releaseDate'], '2020-05-01')
        self.assertEqual(rows[0]['voteAverage'], 8.4)
        self.assertTrue(rows[0]['owned'])
        self.assertFalse(rows[1]['owned'])
        self.assertEqual(rows[1]['year'], 'N/A')
        for call in self.service._session.get.call_args_list:
            self.assertEqual(call.args[0], 'https://api.themoviedb.org/3/tv/100/recommendations')

    def test_later_page_failures_discard_partial_results_for_movies_and_tv(self):
        for lookup in (self.service.find_similar_movies, self.service.find_similar_shows):
            for failed_page in (2, 3):
                for failure in ('http', 'timeout', 'invalid_json'):
                    with self.subTest(lookup=lookup.__name__, page=failed_page, failure=failure):
                        responses = [self.response([{'id': page}], pages=3)
                                     for page in range(1, failed_page)]
                        responses.append({
                            'http': self.response([], status=503),
                            'timeout': Timeout('TMDB timed out'),
                            'invalid_json': Mock(status_code=200, json=Mock(side_effect=ValueError('Invalid JSON'))),
                        }[failure])
                        self.service._session.get.reset_mock()
                        self.service._session.get.side_effect = responses
                        rows, error = lookup('key', 100, set())
                        self.assertIsNone(rows)
                        self.assertIn(f'page {failed_page}', error)
                        self.assertIn('Please try again', error)
                        self.assertEqual(self.service._session.get.call_count, failed_page)

    def test_api_reports_later_page_failure_and_a_new_lookup_can_recover(self):
        app = Flask(__name__)
        app.register_blueprint(recommendations_bp, url_prefix='/api/recommendations')
        app.tmdb_service = self.service
        self.service._api_key = 'key'
        self.service.get_tv_external_ids_batch = Mock(return_value=[{}])
        app.plex_service = Mock(movies_cache={'Library': {'movies': [], 'tmdbIds': []}},
                                shows_cache={'Library': {'shows': []}})
        client = app.test_client()
        for path, id_param in (('/similar', 'movieId'), ('/similar/tv', 'tmdbId')):
            with self.subTest(path=path):
                self.service._session.get.side_effect = [
                    self.response([{'id': 1}], pages=2), self.response([], status=503),
                    self.response([{'id': 2}]),
                ]
                query = {id_param: 100, 'libraryNames': 'Library'}
                failed = client.get('/api/recommendations' + path, query_string=query)
                self.assertEqual(failed.status_code, 502)
                self.assertIn('page 2 (503)', failed.json['error'])
                self.assertNotIn('gaps', failed.json)

                retried = client.get('/api/recommendations' + path, query_string=query)
                self.assertEqual(retried.status_code, 200)
                self.assertEqual([row['tmdbId'] for row in retried.json['gaps']], [2])

    def test_external_seed_lookup_uses_exact_series_matches(self):
        self.service._api_key = 'key'
        self.service._session.get.side_effect = [
            Mock(json=Mock(return_value={'tv_results': [], 'movie_results': [{'id': 1}]})),
            Mock(json=Mock(return_value={'tv_results': [{'id': 20}]})),
        ]
        self.assertEqual(self.service.resolve_tv_tmdb_id(10, 'tt100'), (20, None))
        calls = self.service._session.get.call_args_list
        self.assertTrue(calls[0].args[0].endswith('/find/10'))
        self.assertEqual(calls[0].kwargs['params']['external_source'], 'tvdb_id')
        self.assertEqual(calls[1].kwargs['params']['external_source'], 'imdb_id')

    def test_unmapped_or_ambiguous_tv_seed_is_not_guessed_by_title(self):
        self.service._api_key = 'key'
        for matches in ([], [{'id': 1}, {'id': 2}]):
            self.service._session.get.return_value = Mock(json=Mock(return_value={'tv_results': matches}))
            tmdb_id, error = self.service.resolve_tv_tmdb_id(10)
            self.assertIsNone(tmdb_id)
            self.assertIn('no matching series', error)
