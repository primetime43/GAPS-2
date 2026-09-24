import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from flask import Flask

from app.blueprints.updates import updates_bp
from app.services.build_info import get_build_info
from docker_updater import create_spec, Docker, DockerError, MANAGED, Updater
from update_protocol import image_for, read_json, selection, write_json


class UpdateApiTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        patcher = patch.dict(os.environ, {'GAPS_UPDATES_DIR': folder.name, 'APP_INSTALL_TYPE': 'docker'})
        patcher.start()
        self.addCleanup(patcher.stop)
        app = Flask(__name__)
        app.register_blueprint(updates_bp, url_prefix='/api/updates')
        self.client = app.test_client()
        write_json(self.folder / 'status.json', {'heartbeat': time.time(), 'state': 'idle'})

    def post(self, value, **kwargs):
        return self.client.post('/api/updates/apply', json=value, headers={'X-GAPS-Update': '1', **kwargs})

    def test_selection_is_validated_before_creating_a_request(self):
        for data in ({'channel': 'other'}, {'channel': 'version', 'version': '../../bad'}, None, []):
            with self.subTest(data=data):
                self.assertEqual(self.post(data).status_code, 400)
        self.assertFalse((self.folder / 'request.json').exists())
        self.assertEqual(image_for('primetime43/gaps-2', selection({'channel': 'version', 'version': 'v2.11.0'})),
                         'primetime43/gaps-2:2.11.0')

    def test_update_is_queued_once_and_keeps_the_selection(self):
        result = self.post({'channel': 'develop'})
        self.assertEqual(result.status_code, 202)
        job = read_json(self.folder / 'request.json')
        self.assertEqual(job['id'], result.json['requestId'])
        self.assertEqual(job['selection']['channel'], 'develop')
        self.assertEqual(self.post({'channel': 'stable'}).status_code, 409)

    def test_cross_origin_requests_are_rejected(self):
        self.assertEqual(self.post({'channel': 'stable'}, Origin='https://other.test').status_code, 403)

    def test_https_origin_is_allowed_when_a_proxy_terminates_tls(self):
        self.assertEqual(self.post({'channel': 'stable'}, Origin='https://localhost').status_code, 202)

    def test_dead_updater_cannot_accept_updates(self):
        write_json(self.folder / 'status.json', {'heartbeat': 1, 'state': 'idle'})
        self.assertFalse(self.client.get('/api/updates').json['updater']['available'])
        self.assertEqual(self.post({'channel': 'stable'}).status_code, 503)

    @patch('app.blueprints.updates.requests.get')
    def test_version_list_excludes_drafts_prereleases_and_invalid_tags(self, get):
        get.return_value.json.return_value = [
            {'tag_name': 'v2.11.0'}, {'tag_name': 'v2.10.0', 'draft': True},
            {'tag_name': 'v2.12.0-beta', 'prerelease': True}, {'tag_name': 'random'},
        ]
        self.assertEqual(self.client.get('/api/updates/releases').json['versions'], ['2.11.0'])

    def test_build_metadata_identifies_docker_actions_and_version(self):
        with patch.dict(os.environ, {'APP_VERSION': 'v2.12.0', 'APP_CHANNEL': 'stable',
                                    'APP_BUILD_SOURCE': 'github-actions', 'APP_COMMIT': 'abc123'}):
            info = get_build_info()
        self.assertEqual((info['installType'], info['buildSource'], info['channel']), ('docker', 'github-actions', 'stable'))
        self.assertEqual(info['version'], '2.12.0')
        self.assertEqual(info['commit'], 'abc123')

    def test_legacy_success_is_historical_even_when_helper_heartbeat_is_fresh(self):
        for message in ('Updated to the latest Develop build.', 'Develop is already up to date.'):
            with self.subTest(message=message):
                write_json(self.folder / 'status.json', {
                    'heartbeat': time.time(), 'state': 'done', 'message': message,
                })
                with patch.dict(os.environ, {'APP_COMMIT': '4709c6b', 'APP_CHANNEL': 'develop'}):
                    result = self.client.get('/api/updates').json
                self.assertEqual(result['build']['commit'], '4709c6b')
                self.assertNotIn('latest', result['updater']['message'])
                self.assertNotIn('up to date', result['updater']['message'])
                self.assertNotIn('completedAt', result['updater'])


class DevelopCheckTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(updates_bp, url_prefix='/api/updates')
        self.client = app.test_client()
        cache = patch('app.blueprints.updates._develop_cache', None)
        cache.start()
        self.addCleanup(cache.stop)
        get = patch('app.blueprints.updates.requests.get')
        self.get = get.start()
        self.addCleanup(get.stop)

    def test_github_head_is_reported_independently_of_running_commit_and_cached(self):
        self.get.return_value.json.return_value = {'sha': '6' * 40}
        first = self.client.get('/api/updates/develop')
        second = self.client.get('/api/updates/develop')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json['commit'], '6' * 40)
        self.assertEqual(first.json, second.json)
        self.assertGreater(first.json['checkedAt'], 0)
        self.get.assert_called_once()
        self.assertTrue(self.get.call_args.args[0].endswith('/commits/develop'))

    def test_expired_cache_fetches_new_commit(self):
        self.get.return_value.json.return_value = {'sha': '6' * 40}
        with patch('app.blueprints.updates.time.monotonic', return_value=100):
            self.client.get('/api/updates/develop')
        self.get.return_value.json.return_value = {'sha': '7' * 40}
        with patch('app.blueprints.updates.time.monotonic', return_value=161):
            self.assertEqual(self.client.get('/api/updates/develop').json['commit'], '7' * 40)
        self.assertEqual(self.get.call_count, 2)

    def test_network_failure_is_unknown_and_does_not_reuse_a_stale_success(self):
        import requests
        self.get.return_value.json.return_value = {'sha': '6' * 40}
        with patch('app.blueprints.updates.time.monotonic', return_value=100):
            self.client.get('/api/updates/develop')
        self.get.side_effect = requests.ConnectionError('offline')
        with patch('app.blueprints.updates.time.monotonic', return_value=161):
            for _ in range(2):
                result = self.client.get('/api/updates/develop')
                self.assertEqual(result.status_code, 502)
                self.assertNotIn('commit', result.json)
                self.assertIn('unknown', result.json['error'])
        self.assertEqual(self.get.call_count, 2)

    def test_malformed_response_does_not_claim_to_know_latest_commit(self):
        self.get.return_value.json.return_value = {'sha': 'not-a-commit'}
        self.assertEqual(self.client.get('/api/updates/develop').status_code, 502)


def container_fixture():
    return {
        'Id': 'old-container-id', 'Image': 'sha256:old',
        'State': {'Running': True},
        'Config': {'Image': 'primetime43/gaps-2:latest', 'Labels': {MANAGED: 'true'},
                   'Env': ['APP_COMMIT=old', 'APP_CHANNEL=stable', 'FLASK_ENV=production', 'PUID=1234'],
                   'Cmd': ['gunicorn'], 'Entrypoint': ['/entrypoint.sh']},
        'Mounts': [{'Destination': '/app/data', 'Type': 'volume', 'Source': '/vol/data', 'RW': True}],
        'HostConfig': {'Binds': ['data:/app/data', 'control:/control'], 'PortBindings': {'4277/tcp': [{'HostPort': '4277'}]}},
        'NetworkSettings': {'Networks': {'gaps': {'Aliases': ['gaps2', 'old-container-id'], 'IPAddress': '172.1.1.5'}}},
    }


class DockerIdentityTests(unittest.TestCase):
    def setUp(self):
        with patch.object(Docker, 'call', return_value={'ApiVersion': '1.41'}):
            self.docker = Docker()
        self.helper = {
            'Id': 'new-container-id', 'State': {'Running': True},
            'Config': {'Hostname': 'old-container-id'},
        }
        self.docker.call = Mock(return_value=[{'Id': 'app'}, {'Id': self.helper['Id']}])
        self.docker.container = Mock(side_effect=lambda name: self.helper if name == self.helper['Id'] else {
            'Id': 'app', 'State': {'Running': True}, 'Config': {'Hostname': 'app'},
        })
        hostname = patch('docker_updater.socket.gethostname', return_value='old-container-id')
        hostname.start()
        self.addCleanup(hostname.stop)

    def test_recreated_helper_is_found_by_hostname_and_cached_by_actual_id(self):
        self.assertEqual(self.docker.own_container(), self.helper)
        self.assertEqual(self.docker.own_container(), self.helper)
        self.docker.call.assert_called_once_with('GET', '/containers/json')
        self.docker.container.assert_called_with('new-container-id')

    def test_custom_hostname_is_supported(self):
        self.helper['Config']['Hostname'] = 'gaps2-updater'
        with patch('docker_updater.socket.gethostname', return_value='gaps2-updater'):
            self.assertEqual(self.docker.own_container(), self.helper)

    def test_missing_helper_reports_identity_error_instead_of_volume_error(self):
        self.docker.call.return_value = [{'Id': 'app'}]
        with self.assertRaisesRegex(DockerError, 'Could not identify the running updater'):
            self.docker.own_container()

    def test_duplicate_hostnames_are_rejected_without_caching_a_guess(self):
        self.docker.call.return_value.append({'Id': 'duplicate'})
        self.docker.container.side_effect = lambda name: dict(self.helper, Id=name)
        with self.assertRaisesRegex(DockerError, 'Multiple running containers'):
            self.docker.own_container()
        self.assertIsNone(self.docker._own_container_id)

    def test_stopped_container_with_the_old_hostname_is_ignored(self):
        stopped = dict(self.helper, Id='old-container-id', State={'Running': False})
        self.docker.call.return_value = [{'Id': stopped['Id']}, {'Id': self.helper['Id']}]
        self.docker.container.side_effect = lambda name: stopped if name == stopped['Id'] else self.helper
        self.assertEqual(self.docker.own_container(), self.helper)


class DockerUpdaterTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.folder = Path(folder.name)
        self.docker = Mock()
        self.current = container_fixture()
        self.docker.container.side_effect = lambda name: self.current if name == 'gaps2' else None
        self.docker.create.side_effect = lambda name, spec: self.current.update(Image=spec['Image'])
        self.docker.own_container.return_value = {
            'Mounts': [{'Destination': '/managed-data', 'Type': 'volume', 'Source': '/vol/data', 'RW': True}]}
        self.docker.image.side_effect = lambda name: {
            'Id': 'sha256:old' if name == 'sha256:old' else 'sha256:new',
            'Config': {'Env': ['APP_COMMIT=old', 'APP_CHANNEL=stable'],
                       'Cmd': ['gunicorn'], 'Entrypoint': ['/entrypoint.sh'],
                       'Labels': {'io.gaps.updater.protocol': '1'}},
        }
        self.updater = Updater(self.docker, self.folder / 'control', self.folder / 'state', self.folder / 'data',
                               'gaps2', 'primetime43/gaps-2')
        self.updater.data.mkdir()
        (self.updater.data / 'config.enc').write_bytes(b'original-settings')
        self.updater.wait_healthy = Mock()

    def test_recreation_preserves_ports_mounts_network_aliases_and_user_environment(self):
        spec = create_spec(self.current, 'sha256:new', self.docker.image('sha256:old'))
        self.assertEqual(spec['HostConfig'], self.current['HostConfig'])
        self.assertEqual(spec['NetworkingConfig']['EndpointsConfig']['gaps'], {'Aliases': ['gaps2']})
        self.assertEqual(spec['Env'], ['FLASK_ENV=production', 'PUID=1234'])
        self.assertNotIn('Cmd', spec)
        self.assertNotIn('Entrypoint', spec)

    def test_success_persists_choice_and_backs_up_settings(self):
        self.updater.switch({'channel': 'develop'}, 'a' * 32)
        self.assertEqual(self.updater.status['state'], 'done')
        saved = read_json(self.updater.state / 'selection.json')
        self.assertEqual(saved['imageId'], 'sha256:new')
        self.assertEqual(saved['selection']['channel'], 'develop')
        backups = list((self.updater.state / 'backups').glob('*/config.enc'))
        self.assertEqual(backups[0].read_bytes(), b'original-settings')
        self.assertFalse((self.updater.state / 'transaction.json').exists())

    def test_download_failure_does_not_stop_the_app(self):
        self.docker.pull.side_effect = DockerError('Registry unavailable')
        self.updater.switch({'channel': 'stable'}, 'a' * 32)
        self.assertEqual(self.updater.status['state'], 'error')
        self.docker.stop.assert_not_called()
        self.docker.remove.assert_not_called()

    def test_develop_request_pulls_again_even_when_saved_selection_is_develop(self):
        self.current['Config']['Image'] = 'primetime43/gaps-2:develop'
        write_json(self.updater.state / 'selection.json', {
            'selection': {'channel': 'develop', 'version': ''},
            'image': 'primetime43/gaps-2:develop', 'imageId': 'sha256:old',
        })
        write_json(self.updater.control / 'request.json', {'id': 'a' * 32, 'selection': {'channel': 'develop'}})
        self.updater.tick()
        self.docker.pull.assert_called_once_with('primetime43/gaps-2:develop')
        self.assertEqual(self.docker.create.call_args.args[1]['Image'], 'sha256:new')
        self.assertEqual(self.updater.status['message'], 'Last update installed the Develop image available from the registry at that time.')
        self.assertGreater(self.updater.status['completedAt'], 0)
        self.assertFalse((self.updater.control / 'request.json').exists())

    def test_repeated_develop_checks_pull_but_do_not_restart_an_up_to_date_app(self):
        self.current['Image'] = 'sha256:new'
        self.current['Config']['Image'] = 'primetime43/gaps-2:develop'
        for request_id in ('a' * 32, 'b' * 32):
            self.assertTrue(self.updater.switch({'channel': 'develop'}, request_id))
        self.assertEqual(self.docker.pull.call_count, 2)
        self.docker.pull.assert_called_with('primetime43/gaps-2:develop')
        self.docker.stop.assert_not_called()
        self.docker.create.assert_not_called()
        self.assertEqual(self.updater.status['state'], 'done')
        self.assertEqual(self.updater.status['message'], 'At the last check, the running Develop image matched the registry image.')

    def test_wrong_running_image_is_not_reported_as_success_even_when_health_passes(self):
        self.docker.create.side_effect = None  # Simulate replacement not taking effect.
        self.assertFalse(self.updater.switch({'channel': 'develop'}, 'a' * 32))
        self.assertEqual(self.updater.status['state'], 'error')
        self.assertIn('does not match', self.updater.status['message'])
        self.assertIsNone(self.updater.status['completedAt'])
        self.assertFalse((self.updater.state / 'selection.json').exists())

    def test_heartbeat_does_not_refresh_completion_timestamp(self):
        self.assertTrue(self.updater.switch({'channel': 'develop'}, 'a' * 32))
        completed = self.updater.status['completedAt']
        with patch('docker_updater.time.time', return_value=completed + 600):
            self.updater.tick()
        self.assertEqual(self.updater.status['completedAt'], completed)
        self.assertEqual(self.updater.status['heartbeat'], completed + 600)

    def test_failed_start_restores_previous_image_and_settings(self):
        def health():
            if self.updater.wait_healthy.call_count == 1:
                (self.updater.data / 'config.enc').write_bytes(b'changed-by-new-build')
                raise DockerError('Startup failed')
        self.updater.wait_healthy.side_effect = health
        self.updater.switch({'channel': 'develop'}, 'a' * 32)
        self.assertEqual(self.updater.status['state'], 'error')
        self.assertIn('previous build was restored', self.updater.status['message'])
        self.assertEqual(self.docker.create.call_args.args[1]['Image'], 'sha256:old')
        self.assertEqual((self.updater.data / 'config.enc').read_bytes(), b'original-settings')
        self.assertFalse((self.updater.state / 'selection.json').exists())

    def test_unmanaged_container_and_wrong_volume_are_not_replaced(self):
        for change in ('label', 'volume'):
            with self.subTest(change=change):
                self.current = container_fixture()
                if change == 'label':
                    self.current['Config']['Labels'] = {}
                else:
                    self.current['Mounts'][0]['Source'] = '/other-volume'
                self.updater.switch({'channel': 'develop'}, 'a' * 32)
                self.docker.stop.assert_not_called()

    def test_identity_failure_does_not_pull_or_stop_the_app(self):
        self.docker.own_container.side_effect = DockerError('Could not identify the running updater container.')
        self.assertFalse(self.updater.switch({'channel': 'develop'}, 'a' * 32))
        self.assertIn('Could not identify', self.updater.status['message'])
        self.docker.pull.assert_not_called()
        self.docker.stop.assert_not_called()

    def test_readonly_helper_data_is_rejected_before_stopping_the_app(self):
        self.docker.own_container.return_value['Mounts'][0]['RW'] = False
        self.assertFalse(self.updater.switch({'channel': 'develop'}, 'a' * 32))
        self.docker.stop.assert_not_called()

    def test_compose_recreation_reapplies_saved_image_without_pulling(self):
        saved = {'selection': {'channel': 'develop', 'version': ''}, 'image': 'primetime43/gaps-2:develop', 'imageId': 'sha256:new'}
        write_json(self.updater.state / 'selection.json', saved)
        self.updater.tick()
        self.docker.pull.assert_not_called()
        self.assertEqual(self.docker.create.call_args.args[1]['Image'], 'sha256:new')

    def test_interrupted_update_rolls_back_without_replaying_request(self):
        journal = {'id': 'b' * 32, 'requestId': 'a' * 32, 'previousSpec': create_spec(self.current, 'sha256:old'),
                   'backupReady': False, 'previousSelection': None}
        write_json(self.updater.state / 'transaction.json', journal)
        write_json(self.updater.control / 'request.json', {'id': 'a' * 32, 'selection': {'channel': 'develop'}})
        self.updater.tick()
        self.docker.pull.assert_not_called()
        self.assertFalse((self.updater.control / 'request.json').exists())
        self.assertEqual(self.updater.status['requestId'], 'a' * 32)

    def test_old_releases_without_update_support_are_rejected_before_stopping(self):
        self.docker.image.side_effect = None
        self.docker.image.return_value = {'Id': 'sha256:older', 'Config': {'Labels': {}}}
        self.updater.switch({'channel': 'version', 'version': '2.1.0'}, 'a' * 32)
        self.docker.stop.assert_not_called()
        self.assertIn('predates', self.updater.status['message'])

    def test_failed_reconciliation_does_not_restart_the_app_repeatedly(self):
        saved = {'selection': {'channel': 'develop', 'version': ''}, 'image': 'primetime43/gaps-2:develop', 'imageId': 'sha256:new'}
        write_json(self.updater.state / 'selection.json', saved)
        self.updater.switch = Mock(return_value=False)
        self.updater.tick()
        self.updater.tick()
        self.updater.switch.assert_called_once()
        self.assertEqual(self.updater.status['currentImage'], self.current['Config']['Image'])
