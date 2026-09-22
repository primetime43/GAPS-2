# In-app release switching

**Settings > Updates** offers Stable, Develop, and Specific version. About shows the running version, channel, commit, and whether this is a Docker image built by GitHub Actions or a source checkout. With the updater connected it also shows the image repository: Docker Hub or GitHub Container Registry. These registries carry the same builds; GitHub Actions is the build system, not a separate installation type. Release history remains on About.

In-app switching requires the optional updater and an image containing this feature. Existing single-container installations keep working without it, but must update manually.

## Set up the updater

For a new installation, from the repository root:

```bash
docker compose -f docker/docker-compose.updates.yml up -d
```

This setup uses GitHub Container Registry, port 4277 on localhost, and the named data volume `gaps2-data`. To use Docker Hub, set `GAPS_IMAGE_REPOSITORY=primetime43/gaps-2` in your shell or Compose `.env` file before starting. Set `GAPS_INITIAL_TAG=develop` to bootstrap a development build. To allow LAN access, set `GAPS_BIND_ADDRESS=0.0.0.0`.

## Migrate an existing installation

Stop and remove the old GAPS container without deleting its data volume. Set `GAPS_DATA_VOLUME` to that existing named volume before starting the updater setup. For the original Compose file, the name will usually include the Compose project prefix; inspect the old container's `/app/data` mount to find it. If using a bind mount, change both `gaps2-data:/app/data` and `gaps2-data:/managed-data` to the same host directory. Carry over custom environment variables, including `GAPS2_CONFIG_KEY` if used, ports, and network settings. Do not run two GAPS instances against the same data volume.

The updater alone mounts the Docker socket; the app does not. Docker socket access grants control of the Docker host, so enable this only on a trusted installation. Keep GAPS behind an authenticated proxy if exposing it beyond your trusted network. The helper only accepts the configured, opted-in GAPS container and the two official image repositories.

## Switch builds

1. Open **Settings > Updates** and choose a channel or release version.
2. Click **Apply and restart**. Active scans stop during the restart.
3. The updater pulls the image, stops GAPS, backs up settings and saved scans, and starts the replacement with the existing ports, volumes, and network settings.
4. The page reconnects and reloads after the startup check passes. A failed startup restores the previous image and settings automatically.

Updates are applied on demand, not automatically whenever a new build appears. The chosen image is saved by immutable image ID. If Compose recreates the original bootstrap image later, the updater reapplies that saved image. To intentionally go back to Stable, use the selector before changing the deployment externally.

## Version compatibility

Specific versions must be complete release numbers, such as `2.11.0`, and must support this updater protocol. Older releases are rejected before stopping the app because they would remove the controls needed to switch back; install those manually. A startup check cannot guarantee that every older release understands data written by a newer release.

## Backups and rollback

The updater retains the last three settings/scan backups in its private `updates-state` volume. It backs up `config.enc`, `.config.key`, and saved scan JSON files, not rebuildable metadata caches or the IMDb dataset. Docker images are retained for rollback; remove unused images through your normal Docker maintenance. Stopping this Compose stack stops both containers and leaves data intact. Do not delete the data or updater-state volumes unless you intend to reset the installation.

## Other installation types

Source checkouts show their branch and commit but do not modify themselves from the UI. Windows development scripts remain available; standalone Windows executable releases are discontinued. Older executable downloads remain in their historical GitHub releases.

[Back to the README](../README.md)
