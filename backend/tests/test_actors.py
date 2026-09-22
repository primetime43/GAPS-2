import threading
import unittest
from unittest.mock import Mock

from flask import Flask

from app.blueprints.actors import actors_bp
from app.blueprints.tmdb import tmdb_bp
from app.services.tmdb_service import TmdbService


class ActorLibraryTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.register_blueprint(actors_bp, url_prefix='/api/actors')
        self.app.tmdb_service = Mock(api_key='test-key')
        self.app.plex_service = Mock(movies_cache={}, shows_cache={})
        self.client = self.app.test_client()

    def test_library_errors_are_reported_instead_of_marking_everything_missing(self):
        for media_type, method in [('movie', 'get_movies'), ('tv', 'get_shows')]:
            with self.subTest(media_type=media_type):
                getattr(self.app.plex_service, method).return_value = (None, 'HTTP 503')
                response = self.client.get(
                    f'/api/actors/1/gaps?libraryNames=Library&mediaType={media_type}')
                self.assertEqual(response.status_code, 500)
                self.assertIn('Library', response.json['error'])
                self.assertIn('503', response.json['error'])
        self.app.tmdb_service.get_actor_gaps.assert_not_called()
        self.app.tmdb_service.get_actor_tv_gaps.assert_not_called()

    def test_tv_ownership_only_uses_selected_libraries_and_attaches_provider_ids(self):
        self.app.plex_service.shows_cache = {
            'Selected': {'shows': [{'tmdbId': 1, 'name': 'Owned', 'year': 2020}]},
            'Other': {'shows': [{'tmdbId': 2, 'name': 'Other', 'year': 2021}]},
        }
        self.app.tmdb_service.get_actor_tv_gaps.return_value = ([{'tmdbId': 1}], None)
        self.app.tmdb_service.get_tv_external_ids_batch.return_value = [{'tvdbId': 100, 'imdbId': 'tt123'}]
        self.app.tmdb_service.get_person_details.return_value = None
        self.app.imdb_service = Mock()
        response = self.client.get('/api/actors/1/gaps?libraryNames=Selected&mediaType=tv')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['gaps'][0]['tvdbId'], 100)
        call = self.app.tmdb_service.get_actor_tv_gaps.call_args.kwargs
        self.assertEqual(call['owned_tmdb_ids'], {1})
        self.assertEqual(len(call['owned_shows']), 1)
        self.app.imdb_service.get_ratings.assert_not_called()


class GenreTests(unittest.TestCase):
    def setUp(self):
        # Exercise genre fetching without loading persisted app data or caches.
        self.service = TmdbService.__new__(TmdbService)
        self.service._cache_lock = threading.Lock()
        self.service._genre_cache = {}
        self.service._api_key = 'test-key'
        self.service._language = 'en'
        self.service._base_url = 'https://api.themoviedb.org/3'
        self.service._session = Mock()
        self.app = Flask(__name__)
        self.app.tmdb_service = self.service
        self.app.register_blueprint(tmdb_bp, url_prefix='/api/tmdb')
        self.client = self.app.test_client()

    @staticmethod
    def response(genres, status=200):
        return Mock(status_code=status, json=Mock(return_value={'genres': genres}))

    def test_movie_and_tv_genres_are_cached_separately(self):
        movie = [{'id': 28, 'name': 'Action'}]
        tv = [{'id': 10759, 'name': 'Action & Adventure'}]
        self.service._session.get.side_effect = [self.response(movie), self.response(tv)]
        self.assertEqual(self.client.get('/api/tmdb/genres').json['genres'], movie)
        self.assertEqual(self.client.get('/api/tmdb/genres?mediaType=tv').json['genres'], tv)
        self.assertEqual(self.service.get_movie_genres(), movie)
        self.assertEqual(self.service.get_genres('tv'), tv)
        self.assertEqual(self.service._session.get.call_count, 2)
        self.assertTrue(self.service._session.get.call_args.args[0].endswith('/genre/tv/list'))

    def test_genres_refresh_for_a_changed_language(self):
        self.service._session.get.side_effect = [self.response([]), self.response([{'id': 18, 'name': 'Drame'}])]
        self.service.get_genres('tv')
        self.service._language = 'fr'
        self.assertEqual(self.service.get_genres('tv'), [{'id': 18, 'name': 'Drame'}])
        self.assertEqual(self.service._session.get.call_args.kwargs['params']['language'], 'fr')

    def test_transient_failure_does_not_cache_empty_genres(self):
        self.service._session.get.side_effect = [self.response([], 503), self.response([{'id': 18, 'name': 'Drama'}])]
        self.assertEqual(self.service.get_genres('tv'), [])
        self.assertEqual(self.service.get_genres('tv'), [{'id': 18, 'name': 'Drama'}])

    def test_invalid_media_type_is_rejected(self):
        self.assertEqual(self.client.get('/api/tmdb/genres?mediaType=unknown').status_code, 400)
        self.service._session.get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
