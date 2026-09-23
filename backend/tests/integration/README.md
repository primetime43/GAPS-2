# Docker updater integration check

This opt-in check needs Docker and creates only containers, a network, images, and a volume with a unique test prefix. Run from the repository root in a POSIX shell:

```sh
prefix="gaps-updater-test-$(date +%s)"
docker build -t "$prefix-old" --build-arg BUILD_NAME=old backend/tests/integration
docker build -t "$prefix-new" --build-arg BUILD_NAME=new backend/tests/integration
docker build -t "$prefix-broken" --build-arg BUILD_NAME=broken --build-arg FAIL_START=1 backend/tests/integration
docker run --rm --name "$prefix-helper" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$prefix-data:/managed-data" \
  -v "$PWD/backend:/work:ro" \
  -e PYTHONPATH=/work -e GAPS_TEST_PREFIX="$prefix" \
  "$prefix-old" python /work/tests/integration/check_docker_updates.py
docker volume rm "$prefix-data"
docker image rm "$prefix-old" "$prefix-new" "$prefix-broken"
```

The check covers real container replacement, mount/port/network preservation, saved-selection recovery, and restoration of both the image and settings after a failed startup. Pulling from public registries is mocked so the check never retags or replaces an installed GAPS image.
