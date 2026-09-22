"""Remove legacy Develop commit tags from the official registries; preview by default."""

import argparse
import json
import os
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen


HUB = "https://hub.docker.com/v2/repositories/primetime43/gaps-2/tags/"
GHCR = "https://api.github.com/users/primetime43/packages/container/gaps-2/versions"
COMMIT_TAG = re.compile(r"develop-[0-9a-f]{7,40}")


def request(url, token=None, method="GET", payload=None):
    headers = {"Accept": "application/json", "User-Agent": "GAPS-tag-cleanup"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if url.startswith("https://api.github.com/"):
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload).encode()
    try:
        with urlopen(Request(url, data=data, headers=headers, method=method), timeout=60) as response:
            body = response.read()
            return json.loads(body) if body else None
    except HTTPError as error:
        # Do not log response bodies or credentials.
        raise RuntimeError(f"{method} {url}: HTTP {error.code}") from None


def secret(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


def legacy_tag(name):
    return bool(COMMIT_TAG.fullmatch(name))


def legacy_version(version):
    tags = version["metadata"]["container"]["tags"]
    # GHCR deletes the whole version, including every tag on its digest.
    # Keep shared release/current images, and untagged manifests/attestations.
    return bool(tags) and all(legacy_tag(tag) for tag in tags)


def cleanup_dockerhub(apply=False):
    token = None
    if apply:
        token = request("https://hub.docker.com/v2/auth/token", method="POST", payload={
            "identifier": secret("DOCKERHUB_USERNAME"), "secret": secret("DOCKERHUB_TOKEN"),
        })["access_token"]
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::add-mask::{token}")

    tags = []
    url = HUB + "?page_size=100"
    while url:
        if not url.startswith(HUB):
            raise RuntimeError("Unexpected Docker Hub pagination URL")
        page = request(url, token)
        tags.extend(page["results"])
        url = page["next"]
    if not any(tag["name"] == "develop" for tag in tags):
        raise RuntimeError("No develop tag found; publish Develop before cleaning up")

    candidates = [tag["name"] for tag in tags if legacy_tag(tag["name"])]
    print(f"Docker Hub: {len(candidates)} old Develop tags")
    for name in candidates:
        print(f"{'Delete' if apply else 'Would delete'} {name}")
        if apply:
            # Delete by tag, never by manifest digest (which may have other tags).
            request(HUB + name + "/", token, method="DELETE")


def cleanup_ghcr(apply=False):
    token = secret("GH_TOKEN")
    versions = []
    page = 1
    while True:
        batch = request(f"{GHCR}?per_page=100&page={page}", token)
        versions.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    if not any("develop" in v["metadata"]["container"]["tags"] for v in versions):
        raise RuntimeError("No develop tag found; publish Develop before cleaning up")

    candidates = [v for v in versions if legacy_version(v)]
    print(f"GHCR: {len(candidates)} old Develop versions")
    for version in candidates:
        url = f"{GHCR}/{int(version['id'])}"
        if apply:
            # Recheck in case a release/current tag was added since listing.
            version = request(url, token)
            if not legacy_version(version):
                print(f"Keep version {version['id']}: tags changed")
                continue
        tags = ", ".join(version["metadata"]["container"]["tags"])
        print(f"{'Delete' if apply else 'Would delete'} {tags}")
        if apply:
            request(url, token, method="DELETE")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registry", choices=("dockerhub", "ghcr"))
    parser.add_argument("--apply", action="store_true", help="Delete tags instead of previewing")
    args = parser.parse_args()
    try:
        {"dockerhub": cleanup_dockerhub, "ghcr": cleanup_ghcr}[args.registry](args.apply)
    except (RuntimeError, OSError) as error:
        parser.exit(1, f"Cleanup failed: {error}\n")
