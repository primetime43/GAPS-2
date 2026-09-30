"""Generate versioned Docker installation notes and a standalone Compose asset."""

import argparse
from pathlib import Path
import re
from urllib.parse import quote


def prepare_release(tag, image_version, output_dir):
    # Use metadata-action's version so prerelease tags match the published image.
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", image_version):
        raise ValueError(f"Invalid Docker image version: {image_version!r}")

    release_url = (
        "https://github.com/primetime43/GAPS-2/releases/download/"
        f"{quote(tag, safe='')}/compose.yml"
    )
    compose = f"""# Downloaded from the GAPS 2 release. Start with: docker compose up -d
services:
  gaps2:
    image: ghcr.io/primetime43/gaps-2:{image_version}
    ports:
      - "4277:4277"
    environment:
      FLASK_ENV: production
      PUID: ${{PUID:-1000}}
      PGID: ${{PGID:-1000}}
    volumes:
      - gaps2-data:/app/data
    restart: unless-stopped

volumes:
  gaps2-data:
    name: ${{GAPS_DATA_VOLUME:-gaps2-data}}
"""
    notes = f"""## Docker images

The same release image is available from [GitHub Container Registry](https://github.com/primetime43/GAPS-2/pkgs/container/gaps-2) and [Docker Hub](https://hub.docker.com/r/primetime43/gaps-2/tags?name={quote(image_version, safe='')}).

```bash
docker pull ghcr.io/primetime43/gaps-2:{image_version}
# Or Docker Hub:
docker pull primetime43/gaps-2:{image_version}
```

### Install with Docker Compose

Download [compose.yml]({release_url}) from **Assets**, put it in a folder for GAPS 2, and run this command from that folder:

```bash
docker compose up -d
```

Open http://localhost:4277. The Compose file uses this release's exact image version and stores settings in the persistent `gaps2-data` Docker volume. If you already have a GAPS installation, set `GAPS_DATA_VOLUME` in a `.env` file to your existing volume name before starting.

For optional in-app updates and channel switching, see the [release switching guide](https://github.com/primetime43/GAPS-2/blob/main/docs/release-switching.md).

---

"""
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "compose.yml").write_text(compose, encoding="utf-8")
    (output_dir / "docker-notes.md").write_text(notes, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--image-version", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    prepare_release(args.tag, args.image_version, args.output_dir)
