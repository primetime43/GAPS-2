import unittest
from unittest.mock import Mock

from flask import Flask
from app.blueprints.recommendations import recommendations_bp
from app.blueprints.imdb import imdb_bp
from app.blueprints.tmdb import tmdb_bp


class SimilarTvTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(recommendations_bp, url_prefix='/api/recommendations')
        self.app.register_blueprint(imdb_bp, url_prefix='/api/imdb')
        self.app.register_blueprint(tmdb_bp, url_prefix='/api/tmdb')
        self.tmdb = self.app.tmdb_service = Mock(api_key='key')
        self.app.imdb_service = Mock()
        self.media = self.app.plex_service = Mock(shows_cache={
            'TV': {'shows': [
                {'name': 'Owned TVDB', 'year': 2020, 'tvdbId': 10},
                {'name': 'Owned IMDb', 'year': 2021, 'imdbId': 'tt200'},
                {'name': 'Owned TMDB', 'year': 2022, 'tmdbId': 3},
            ]},
        })
        self.client = self.app.test_client()
        self.tmdb.find_similar_shows.return_value = ([
            {'tmdbId': 1, 'owned': False}, {'tmdbId': 2, 'owned': False},
            {'tmdbId': 3, 'owned': True}, {'tmdbId': 4, 'owned': False},
        ], None)
        self.tmdb.get_tv_external_ids_batch.return_value = [
            {'tvdbId': 10, 'imdbId': 'tt100'}, {'tvdbId': 20, 'imdbId': 'tt200'},
            {'tvdbId': None, 'imdbId': None}, {'tvdbId': None, 'imdbId': None},
        ]

    def lookup(self, **params):
        return self.client.get('/api/recommendations/similar/tv', query_string={
            'tmdbId': 100, 'libraryNames': ['TV'], **params,
        })

    def test_tv_ownership_uses_all_provider_ids_and_preserves_unmapped_results(self):
        response = self.lookup()
        self.assertEqual(response.status_code, 200)
        rows = response.json['gaps']
        self.assertEqual([row['owned'] for row in rows], [True, True, True, False])
        self.assertEqual(rows[0]['tvdbId'], 10)
        self.assertIsNone(rows[3]['tvdbId'])
        args = self.tmdb.find_similar_shows.call_args.kwargs
        self.assertEqual(args['owned_tmdb_ids'], {3})
        self.assertIn('owned tvdb|2020', args['owned_title_year'])
        self.tmdb.find_similar_movies.assert_not_called()

    def test_tvdb_only_seed_is_resolved_before_recommendations(self):
        self.tmdb.resolve_tv_tmdb_id.return_value = (500, None)
        response = self.lookup(tmdbId='', tvdbId=400)
        self.assertEqual(response.status_code, 200)
        self.tmdb.resolve_tv_tmdb_id.assert_called_once_with(400, '')
        self.assertEqual(self.tmdb.find_similar_shows.call_args.kwargs['tmdb_id'], 500)

    def test_missing_libraries_ids_or_key_are_validation_errors(self):
        for params in ({'libraryNames': []}, {'tmdbId': ''}):
            self.assertEqual(self.lookup(**params).status_code, 400)
        self.tmdb.api_key = ''
        self.assertEqual(self.lookup().status_code, 400)
        self.tmdb.find_similar_shows.assert_not_called()

    def test_failed_library_or_seed_lookup_does_not_return_misleading_missing_results(self):
        self.media.get_shows.return_value = (None, 'offline')
        response = self.lookup(libraryNames=['TV', 'Broken'])
        self.assertEqual(response.status_code, 502)
        self.assertIn('Broken', response.json['error'])
        self.tmdb.find_similar_shows.assert_not_called()
        self.tmdb.resolve_tv_tmdb_id.return_value = (None, 'No matching series')
        response = self.lookup(tmdbId='', tvdbId=400)
        self.assertEqual(response.status_code, 502)
        self.tmdb.find_similar_shows.assert_not_called()

    def test_recommendation_failure_is_reported(self):
        self.tmdb.find_similar_shows.return_value = (None, 'TMDB offline')
        response = self.lookup()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json['error'], 'TMDB offline')
        self.tmdb.get_tv_external_ids_batch.assert_not_called()

    def test_tv_ratings_resolve_tv_ids_not_movie_ids(self):
        self.tmdb.get_tv_external_ids_batch.return_value = [{'imdbId': 'tt100'}]
        self.app.imdb_service.get_ratings.return_value = {'tt100': {'aggregateRating': 8, 'voteCount': 500}}
        response = self.client.post('/api/imdb/ratings', json={'tmdbIds': [1], 'mediaType': 'tv'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['ratings']['1']['aggregateRating'], 8)
        self.tmdb.get_tv_external_ids_batch.assert_called_once_with([1])
        self.tmdb.get_imdb_ids.assert_not_called()

    def test_default_ratings_still_resolve_movie_ids(self):
        self.tmdb.get_imdb_ids.return_value = ['tt100']
        self.app.imdb_service.get_ratings.return_value = {}
        self.assertEqual(self.client.post('/api/imdb/ratings', json={'tmdbIds': [1]}).status_code, 200)
        self.tmdb.get_imdb_ids.assert_called_once_with([1])
        self.tmdb.get_tv_external_ids_batch.assert_not_called()

    def test_tv_imdb_link_redirects_or_falls_back_to_tv_page(self):
        self.tmdb.get_tv_external_ids.return_value = {'imdbId': 'tt100'}
        response = self.client.get('/api/tmdb/tv/1/imdb')
        self.assertEqual(response.location, 'https://www.imdb.com/title/tt100/')
        self.tmdb.get_tv_external_ids.return_value = {}
        self.assertEqual(self.client.get('/api/tmdb/tv/1/imdb').location, 'https://www.themoviedb.org/tv/1')
