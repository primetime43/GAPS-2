"""Optional Docker controller. Only this process receives the Docker socket."""

import copy
import http.client
import json
import logging
import os
from pathlib import Path
import re
import shutil
import socket
import threading
import time
from urllib.parse import quote, urlencode
import uuid

from update_protocol import image_for, read_json, selection, write_json

log = logging.getLogger('gaps-updater')
MANAGED = 'io.gaps.updates.enabled'
DATA_FILES = ('config.enc', '.config.key', 'last_scan.json', 'last_tv_scan.json', 'scan_history.json')


class DockerError(RuntimeError):
    pass


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect('/var/run/docker.sock')


class Docker:
    def __init__(self):
        self.prefix = ''
        self._own_container_id = None
        version = self.call('GET', '/version')['ApiVersion']
        if not re.fullmatch(r'\d+\.\d+', version):
            raise DockerError('Invalid Docker API version')
        self.prefix = f'/v{version}'

    def call(self, method, path, payload=None, stream=False, missing_ok=False):
        connection = UnixConnection('localhost', timeout=600 if stream else 45)
        try:
            body = json.dumps(payload) if payload is not None else None
            connection.request(method, self.prefix + path, body, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            if missing_ok and response.status == 404:
                return None
            if response.status >= 400:
                error = response.read().decode('utf-8', errors='replace')[:1000]
                raise DockerError(f'Docker returned {response.status}: {error}')
            if stream:
                for line in response:
                    if not line.strip():
                        continue
                    event = json.loads(line)
                    if event.get('error'):
                        raise DockerError(event['error'])
                return None
            raw = response.read()
            if not raw:
                return None
            if 'application/json' in response.getheader('Content-Type', ''):
                return json.loads(raw)
            return raw
        finally:
            connection.close()

    def container(self, name):
        return self.call('GET', f'/containers/{quote(name, safe="")}/json', missing_ok=True)

    def own_container(self):
        """Find this helper even when recreation retained its previous hostname."""
        if self._own_container_id:
            current = self.container(self._own_container_id)
            if current and current.get('State', {}).get('Running'):
                return current
            self._own_container_id = None

        # Docker's default hostname resembles a container ID, but tools can
        # preserve it when recreating a container. Match the configured hostname
        # among running containers instead of interpreting it as an ID or name.
        hostname = socket.gethostname()
        matches = []
        for summary in self.call('GET', '/containers/json'):
            candidate = self.container(summary['Id'])
            if (candidate and candidate.get('State', {}).get('Running')
                    and candidate.get('Config', {}).get('Hostname') == hostname):
                matches.append(candidate)
        if not matches:
            raise DockerError('Could not identify the running updater container. Recreate the updater with a unique hostname.')
        if len(matches) != 1:
            raise DockerError('Multiple running containers share the updater hostname. Give the updater a unique hostname.')
        self._own_container_id = matches[0]['Id']
        return matches[0]

    def image(self, name):
        return self.call('GET', f'/images/{quote(name, safe="")}/json')

    def pull(self, name):
        repository, tag = name.rsplit(':', 1)
        self.call('POST', '/images/create?' + urlencode({'fromImage': repository, 'tag': tag}), stream=True)

    def stop(self, name):
        self.call('POST', f'/containers/{quote(name, safe="")}/stop?t=30')

    def remove(self, name):
        # Deliberately do not remove volumes or images.
        self.call('DELETE', f'/containers/{quote(name, safe="")}?force=true')

    def create(self, name, payload):
        self.call('POST', '/containers/create?' + urlencode({'name': name}), payload)
        self.call('POST', f'/containers/{quote(name, safe="")}/start')

    def healthy(self, name):
        container = self.container(name)
        if not container or not container['State']['Running']:
            return False
        command = ['python', '-c',
                   "import urllib.request; urllib.request.urlopen('http://127.0.0.1:4277/api/about', timeout=3).read()"]
        job = self.call('POST', f'/containers/{quote(name, safe="")}/exec',
                        {'Cmd': command, 'AttachStdout': True, 'AttachStderr': True})
        self.call('POST', f'/exec/{job["Id"]}/start', {'Detach': False, 'Tty': False})
        return self.call('GET', f'/exec/{job["Id"]}/json').get('ExitCode') == 0


def create_spec(container, image, previous_image=None):
    """Preserve deployment settings, while taking new defaults from the image."""
    config = container['Config']
    keys = ('Env', 'Cmd', 'Entrypoint', 'WorkingDir', 'User', 'ExposedPorts', 'Labels',
            'Healthcheck', 'StopSignal', 'StopTimeout', 'Tty', 'OpenStdin')
    spec = {key: copy.deepcopy(config[key]) for key in keys if key in config}
    if previous_image is not None:
        defaults = previous_image.get('Config') or {}
        for key in ('Cmd', 'Entrypoint', 'WorkingDir', 'User', 'Healthcheck', 'StopSignal', 'StopTimeout'):
            if spec.get(key) == defaults.get(key):
                spec.pop(key, None)
        default_env = set(defaults.get('Env') or [])
        spec['Env'] = [item for item in spec.get('Env', [])
                       if (item not in default_env or item.startswith(('PUID=', 'PGID=', 'GAPS_', 'GAPS2_')))
                       and not item.startswith(
                           ('APP_COMMIT=', 'APP_VERSION=', 'APP_CHANNEL=', 'APP_BUILD_SOURCE=', 'APP_INSTALL_TYPE='))]
        spec['Labels'] = {key: value for key, value in spec.get('Labels', {}).items()
                          if key not in (defaults.get('Labels') or {})}
        spec['Labels'][MANAGED] = 'true'
    spec['Image'] = image
    spec['HostConfig'] = copy.deepcopy(container['HostConfig'])
    if container['NetworkSettings'].get('Ports'):
        spec['HostConfig']['PortBindings'] = {
            port: bindings for port, bindings in container['NetworkSettings']['Ports'].items() if bindings
        }
    endpoints = {}
    for name, network in container['NetworkSettings']['Networks'].items():
        endpoint = {key: copy.deepcopy(network[key]) for key in ('IPAMConfig', 'DriverOpts') if network.get(key)}
        endpoint['Aliases'] = [alias for alias in (network.get('Aliases') or [])
                               if alias not in (container['Id'], container['Id'][:12])]
        endpoints[name] = endpoint
    spec['NetworkingConfig'] = {'EndpointsConfig': endpoints}
    return spec


class Updater:
    def __init__(self, docker, control, state, data, target, repository):
        self.docker, self.control, self.state, self.data = docker, Path(control), Path(state), Path(data)
        self.target, self.repository = target, repository
        image_for(repository, {'channel': 'stable'})  # fixed repository allowlist
        self.control.mkdir(parents=True, exist_ok=True)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.status = read_json(self.control / 'status.json', {'state': 'idle', 'message': 'Ready.'})
        self.lock = threading.Lock()

    def report(self, **fields):
        with self.lock:
            self.status.update(fields)
            self.status['heartbeat'] = time.time()
            write_json(self.control / 'status.json', self.status, mode=0o644)

    def target_container(self):
        current = self.docker.container(self.target)
        if not current or current['Config'].get('Labels', {}).get(MANAGED) != 'true':
            raise DockerError('Target container is missing or is not opted in to updates.')
        helper = self.docker.own_container()
        mount = next((m for m in current['Mounts'] if m['Destination'] == '/app/data'), None)
        helper_mount = next((m for m in (helper or {}).get('Mounts', []) if m['Destination'] == '/managed-data'), None)
        if not mount or not mount.get('RW') or not helper_mount or not helper_mount.get('RW') or (
                mount['Type'], mount['Source']) != (helper_mount['Type'], helper_mount['Source']):
            raise DockerError('The app and updater must share the same persistent data volume.')
        return current

    def backup(self, folder):
        folder.mkdir(parents=True, mode=0o700)
        for name in DATA_FILES:
            path = self.data / name
            if path.is_symlink():
                raise DockerError('Cannot back up a symlink in the configuration directory.')
            if path.exists():
                shutil.copyfile(path, folder / name)
                os.chmod(folder / name, 0o600)

    def restore(self, folder):
        for name in DATA_FILES:
            destination = self.data / name
            if destination.is_symlink():
                raise DockerError('Cannot restore over a configuration symlink.')
            if (folder / name).exists():
                shutil.copyfile(folder / name, destination)
                os.chmod(destination, 0o600)
            else:
                destination.unlink(missing_ok=True)

    def wait_healthy(self):
        for _ in range(60):
            try:
                if self.docker.healthy(self.target):
                    return
            except (OSError, DockerError):
                pass
            time.sleep(2)
        raise DockerError('The new container did not become ready within two minutes.')

    def rollback(self, journal):
        self.report(state='rolling-back', message='Restoring the previous build and settings.')
        existing = self.docker.container(self.target)
        if existing:
            if existing['Config'].get('Labels', {}).get(MANAGED) != 'true':
                raise DockerError('Refusing to replace a container not managed by GAPS.')
            self.docker.stop(self.target)
            self.docker.remove(self.target)
        if journal.get('backupReady'):
            self.restore(self.state / 'backups' / journal['id'])
        self.docker.create(self.target, journal['previousSpec'])
        self.wait_healthy()
        if journal.get('previousSelection'):
            write_json(self.state / 'selection.json', journal['previousSelection'])
        else:
            (self.state / 'selection.json').unlink(missing_ok=True)
        (self.state / 'transaction.json').unlink(missing_ok=True)

    def switch(self, choice, request_id, pinned_image=None):
        choice = selection(choice)
        image = image_for(self.repository, choice)
        self.report(state='pulling', message=f'Downloading {image}.', requestId=request_id,
                    completedAt=None)
        journal = None
        try:
            current = self.target_container()
            if not pinned_image:
                self.docker.pull(image)
            new_image = self.docker.image(pinned_image or image)
            if (new_image.get('Config', {}).get('Labels') or {}).get('io.gaps.updater.protocol') != '1':
                raise DockerError('This release predates in-app switching. Install it manually or choose a newer build.')
            changed = current['Image'] != new_image['Id']
            if changed:
                previous = self.docker.image(current['Image'])
                journal = {'id': uuid.uuid4().hex, 'requestId': request_id,
                           'previousSpec': create_spec(current, current['Image']), 'backupReady': False,
                           'previousSelection': read_json(self.state / 'selection.json')}
                write_json(self.state / 'transaction.json', journal)
                self.report(state='backing-up', message='Stopping scans and backing up settings.')
                self.docker.stop(self.target)
                self.backup(self.state / 'backups' / journal['id'])
                journal['backupReady'] = True
                write_json(self.state / 'transaction.json', journal)
                self.report(state='restarting', message='Starting the selected build.')
                self.docker.remove(self.target)
                self.docker.create(self.target, create_spec(current, new_image['Id'], previous))
                self.report(state='checking', message='Waiting for the app to be ready.')
                self.wait_healthy()
            running = self.docker.container(self.target)
            if not running or not running.get('State', {}).get('Running') or running.get('Image') != new_image['Id']:
                raise DockerError('The running container does not match the selected image.')
            write_json(self.state / 'selection.json', {'selection': choice, 'image': image, 'imageId': new_image['Id']})
            (self.state / 'transaction.json').unlink(missing_ok=True)
            message = 'Last update completed: the selected build started successfully.'
            if choice['channel'] == 'develop' and not pinned_image:
                message = ('Last update installed the Develop image available from the registry at that time.'
                           if changed else 'At the last check, the running Develop image matched the registry image.')
            self.report(state='done', message=message, selection=choice,
                        completedAt=time.time(),
                        currentImage=image, imageId=new_image['Id'], registry=self.repository.split('/')[0]
                        if self.repository.startswith('ghcr.io/') else 'Docker Hub')
            try:
                self.prune_backups()
            except OSError:
                log.exception('Could not remove old updater backups')
            return True
        except Exception as exc:
            message = str(exc)
            if journal:
                try:
                    self.rollback(journal)
                    message += ' The previous build was restored.'
                except Exception as rollback_error:
                    message += f' Rollback needs attention: {rollback_error}'
            self.report(state='error', message=message)
            log.error('%s', message)
            return False

    def prune_backups(self):
        folders = sorted((self.state / 'backups').glob('*'), key=lambda p: p.stat().st_mtime, reverse=True)
        for folder in folders[3:]:
            if folder.is_dir() and not folder.is_symlink() and re.fullmatch(r'[a-f0-9]{32}', folder.name):
                shutil.rmtree(folder)

    def tick(self):
        journal = read_json(self.state / 'transaction.json')
        if journal:
            self.rollback(journal)
            pending = read_json(self.control / 'request.json')
            if pending and pending.get('id') == journal.get('requestId'):
                (self.control / 'request.json').unlink(missing_ok=True)
            self.report(state='error', message='An interrupted update was rolled back.', requestId=journal.get('requestId'))
            return
        request_path = self.control / 'request.json'
        job = read_json(request_path)
        if job:
            # Keep the request until completion, preventing duplicate submissions.
            try:
                if not re.fullmatch(r'[a-f0-9]{32}', str(job.get('id', ''))):
                    raise ValueError('Invalid update request ID.')
                self.switch(selection(job.get('selection')), job['id'])
            finally:
                request_path.unlink(missing_ok=True)
            return
        current = self.target_container()
        saved = read_json(self.state / 'selection.json')
        if saved and current['Image'] != saved['imageId'] and not saved.get('reconcileBlocked'):
            # Compose can recreate its bootstrap image. Reapply the saved choice
            # by immutable image ID without silently updating to a newer build.
            if not self.switch(saved['selection'], uuid.uuid4().hex, pinned_image=saved['imageId']):
                # Leave the recovered app running instead of retrying a broken
                # image every three seconds. A new Apply request clears this.
                saved['reconcileBlocked'] = True
                write_json(self.state / 'selection.json', saved)
            return
        self.report(currentImage=saved['image'] if saved and current['Image'] == saved['imageId'] else current['Config']['Image'],
                    imageId=current['Image'], selection=(saved or {}).get('selection'))


def main():
    logging.basicConfig(level=logging.INFO)
    updater = Updater(Docker(), '/control', '/state', '/managed-data',
                      os.environ.get('GAPS_TARGET_CONTAINER', 'gaps2'),
                      os.environ.get('GAPS_IMAGE_REPOSITORY', 'ghcr.io/primetime43/gaps-2'))
    os.chown(updater.control, int(os.environ.get('PUID', '1000')), int(os.environ.get('PGID', '1000')))

    def heartbeat():
        while True:
            try:
                updater.report()
            except OSError:
                log.exception('Could not write updater status')
            time.sleep(5)

    threading.Thread(target=heartbeat, daemon=True).start()
    while True:
        try:
            updater.tick()
        except Exception as exc:
            updater.report(state='error', message=str(exc))
            log.exception('Updater failed')
        time.sleep(3)


if __name__ == '__main__':
    main()
