# In-app release switching

**Settings > Updates** offers Stable, Develop, and Specific version. About shows the running version, channel, commit, and whether this is a Docker image built by GitHub Actions or a source checkout. With the updater connected it also shows the image repository: Docker Hub or GitHub Container Registry. These registries carry the same builds; GitHub Actions is the build system, not a separate installation type. Release history remains on About.

In-app switching requires the optional updater and an image containing this feature. Existing single-container installations keep working without it, but must update manually.

For SSH, use the [Synology setup commands](#synology-setup-over-ssh) once, then the [release switching commands](#switch-builds-over-ssh). If your updater is already connected, skip setup.

## Set up the updater

For a new installation, from the repository root:

```bash
docker compose -f docker/docker-compose.updates.yml up -d
```

This setup uses GitHub Container Registry, port 4277 on localhost, and the named data volume `gaps2-data`. To use Docker Hub, set `GAPS_IMAGE_REPOSITORY=primetime43/gaps-2` in your shell or Compose `.env` file before starting. Set `GAPS_INITIAL_TAG=develop` to bootstrap a development build. To allow LAN access, set `GAPS_BIND_ADDRESS=0.0.0.0`.

## Migrate an existing installation

Stop and remove the old GAPS container without deleting its data volume. Set `GAPS_DATA_VOLUME` to that existing named volume before starting the updater setup. For the original Compose file, the name will usually include the Compose project prefix; inspect the old container's `/app/data` mount to find it. If using a bind mount, change both `gaps2-data:/app/data` and `gaps2-data:/managed-data` to the same host directory. Carry over custom environment variables, including `GAPS2_CONFIG_KEY` if used, ports, and network settings. Do not run two GAPS instances against the same data volume.

The updater alone mounts the Docker socket; the app does not. Docker socket access grants control of the Docker host, so enable this only on a trusted installation. Keep GAPS behind an authenticated proxy if exposing it beyond your trusted network. The helper only accepts the configured, opted-in GAPS container and the two official image repositories.

### Synology setup over SSH

This example migrates a standalone container named `primetime43-gaps-2-1`, using `/volume1/docker/appdata/gaps-2` for data and port `4277`. It creates the app and updater directly, without a repository checkout or Compose file. Use either this setup or Compose, not both.

Change the first five values to match your container. Back up your data folder first, and add any custom environment variables (especially `GAPS2_CONFIG_KEY`), mounts, or network options to the app's `docker run` command. The example publishes port 4277 to your LAN and uses Develop to start with a build that includes the updater.

Paste the entire block into your NAS SSH terminal:

```bash
(
set -e
GAPS_CONTAINER=primetime43-gaps-2-1
GAPS_DATA=/volume1/docker/appdata/gaps-2
GAPS_PORT=4277
GAPS_UID=1000
GAPS_GID=1000

# Check the existing installation and download before stopping anything.
sudo test -d "$GAPS_DATA"
sudo docker inspect "$GAPS_CONTAINER" >/dev/null
if sudo docker inspect gaps2-updater >/dev/null 2>&1; then
  printf 'An updater already exists. Use the switching commands below.\n'
  exit 1
fi
sudo docker pull primetime43/gaps-2:develop

# Keep the old container as a stopped backup.
sudo docker stop "$GAPS_CONTAINER"
sudo docker update --restart=no "$GAPS_CONTAINER"
sudo docker rename "$GAPS_CONTAINER" "${GAPS_CONTAINER}-backup-$(date +%Y%m%d-%H%M%S)"

sudo docker run -d \
  --name "$GAPS_CONTAINER" \
  --restart unless-stopped \
  --label io.gaps.updates.enabled=true \
  -p "$GAPS_PORT:4277" \
  -e PUID="$GAPS_UID" -e PGID="$GAPS_GID" \
  -e GAPS_UPDATES_DIR=/control \
  --mount "type=bind,src=$GAPS_DATA,dst=/app/data" \
  -v gaps2-updates-control:/control \
  primetime43/gaps-2:develop

sudo docker run -d \
  --name gaps2-updater \
  --restart unless-stopped \
  --entrypoint python \
  -e GAPS_TARGET_CONTAINER="$GAPS_CONTAINER" \
  -e GAPS_IMAGE_REPOSITORY=primetime43/gaps-2 \
  -e PUID="$GAPS_UID" -e PGID="$GAPS_GID" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  --mount "type=bind,src=$GAPS_DATA,dst=/managed-data" \
  -v gaps2-updates-control:/control \
  -v gaps2-updates-state:/state \
  primetime43/gaps-2:develop /app/docker_updater.py
)
```

Open `http://YOUR-NAS-IP:4277/settings/updates` and wait for the updater to connect. Leave the backup container stopped; it shares the same data folder. If setup stops with an error, check `sudo docker ps -a` before retrying. These commands are for one-time migration, not each release switch.

## Switch builds

1. Open **Settings > Updates** and choose a channel or release version.
2. Click **Apply and restart**. Active scans stop during the restart.
3. The updater pulls the image, stops GAPS, backs up settings and saved scans, and starts the replacement with the existing ports, volumes, and network settings.
4. The page reconnects and reloads after the startup check passes. A failed startup restores the previous image and settings automatically.

Updates are applied on demand, not automatically whenever a new build appears. The chosen image is saved by immutable image ID. If Compose recreates the original bootstrap image later, the updater reapplies that saved image. To intentionally go back to Stable, use the selector before changing the deployment externally.

## Switch builds over SSH

With the updater connected, run **one** of these commands on the NAS. They use the same update process as the app, including backups and rollback. Change `4277` if you use a different host port. Each request restarts GAPS and stops active scans.

**Stable:**

```bash
curl -sS http://127.0.0.1:4277/api/updates/apply \
  -H 'Content-Type: application/json' -H 'X-GAPS-Update: 1' \
  -d '{"channel":"stable"}'
```

**Develop** (also pulls the newest Develop build when already on Develop):

```bash
curl -sS http://127.0.0.1:4277/api/updates/apply \
  -H 'Content-Type: application/json' -H 'X-GAPS-Update: 1' \
  -d '{"channel":"develop"}'
```

**Specific version** (enter a published release number when prompted):

```bash
printf 'Release version: '
read -r GAPS_VERSION
curl -sS http://127.0.0.1:4277/api/updates/apply \
  -H 'Content-Type: application/json' -H 'X-GAPS-Update: 1' \
  -d "{\"channel\":\"version\",\"version\":\"$GAPS_VERSION\"}"
```

A response saying `Update queued` means the request was accepted. Wait for GAPS to restart, then check the result:

```bash
curl -sS http://127.0.0.1:4277/api/updates
```

The response includes the running `build` and the `updater` state and message. A connection error during the restart is normal; check again after a few seconds. If the updater is unavailable, finish the one-time setup above. Stable and specific-version switches require a destination image supporting the updater; older images are rejected and the current build stays running.

## Version compatibility

Specific versions must be complete release numbers, such as `2.11.0`, and must support this updater protocol. Older releases are rejected before stopping the app because they would remove the controls needed to switch back; install those manually. A startup check cannot guarantee that every older release understands data written by a newer release.

## Backups and rollback

The updater retains the last three settings/scan backups in its private `updates-state` volume. It backs up `config.enc`, `.config.key`, and saved scan JSON files, not rebuildable metadata caches or the IMDb dataset. Docker images are retained for rollback; remove unused images through your normal Docker maintenance. Stopping this Compose stack stops both containers and leaves data intact. Do not delete the data or updater-state volumes unless you intend to reset the installation.

## Other installation types

Source checkouts show their branch and commit but do not modify themselves from the UI. Windows development scripts remain available; standalone Windows executable releases are discontinued. Older executable downloads remain in their historical GitHub releases.

[Back to the README](../README.md)
