"""Run inside an isolated helper container; see this directory's README."""
import os
from pathlib import Path
import tempfile
import time

from docker_updater import Docker, DockerError, MANAGED, Updater, create_spec

prefix = os.environ['GAPS_TEST_PREFIX']
assert prefix.startswith('gaps-updater-test-')
target, network, volume = prefix + '-app', prefix + '-net', prefix + '-data'


class FixtureDocker(Docker):
    candidate = prefix + '-new'

    def pull(self, name):
        # Exercise replacement with local fixture images, never registry tags.
        pass

    def image(self, name):
        if name.startswith('primetime43/gaps-2:'):
            name = self.candidate
        return super().image(name)


docker = FixtureDocker()
docker.call('POST', '/networks/create', {'Name': network})
try:
    docker.create(target, {
        'Image': prefix + '-old', 'Labels': {MANAGED: 'true'},
        'Env': ['GAPS_UPDATES_DIR=/control', 'CUSTOM_SETTING=kept'],
        'HostConfig': {'Binds': [volume + ':/app/data'], 'NetworkMode': network,
                       'PortBindings': {'4277/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '0'}]}},
        'NetworkingConfig': {'EndpointsConfig': {network: {'Aliases': ['gaps-fixture']}}},
    })
    with tempfile.TemporaryDirectory() as folder:
        updater = Updater(docker, Path(folder) / 'control', Path(folder) / 'state', '/managed-data', target, 'primetime43/gaps-2')
        updater.wait_healthy()
        original = docker.container(target)
        Path('/managed-data/config.enc').write_bytes(b'original-settings')
        updater.switch({'channel': 'develop'}, 'a' * 32)
        assert updater.status['state'] == 'done', updater.status
        current = docker.container(target)
        assert 'APP_COMMIT=new' in current['Config']['Env'], current['Config']['Env']
        assert 'CUSTOM_SETTING=kept' in current['Config']['Env']
        assert current['NetworkSettings']['Ports'] == original['NetworkSettings']['Ports'], 'Port changed'
        assert 'gaps-fixture' in current['NetworkSettings']['Networks'][network]['Aliases']
        print('PASS: replacement preserves data, ports, network aliases, and user settings; build metadata updates.', flush=True)

        docker.stop(target)
        docker.remove(target)
        docker.create(target, create_spec(original, original['Image']))
        updater.tick()
        assert updater.status['state'] == 'done', updater.status
        assert docker.container(target)['Image'] == current['Image']
        print('PASS: saved selection survives a Compose-style recreation.', flush=True)

        docker.candidate = prefix + '-broken'

        def quick_health_check():
            for _ in range(8):
                if docker.healthy(target):
                    return
                time.sleep(0.5)
            raise DockerError('Fixture startup failed')

        updater.wait_healthy = quick_health_check
        updater.switch({'channel': 'stable'}, 'b' * 32)
        assert updater.status['state'] == 'error', updater.status
        assert 'previous build was restored' in updater.status['message'], updater.status
        assert docker.container(target)['Image'] == current['Image']
        assert Path('/managed-data/config.enc').read_bytes() == b'original-settings'
        print('PASS: failed startup restores the previous image and configuration.', flush=True)
finally:
    if docker.container(target):
        docker.remove(target)
    docker.call('DELETE', '/networks/' + network)
