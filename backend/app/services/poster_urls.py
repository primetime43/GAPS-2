"""Versioned poster URLs that browsers can cache without mixing media servers."""

import hashlib
import json
from urllib.parse import urlencode

POSTER_WIDTH = 300
POSTER_HEIGHT = 450


def poster_scope(source: str, server_url: str, token: str) -> str:
    # Include the rendition in the version so size changes invalidate old images.
    identity = [source, server_url.rstrip('/'), token, POSTER_WIDTH, POSTER_HEIGHT]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def poster_url(source: str, server_url: str, token: str, *,
               thumb: str = '', item_id: str = '', image_tag: str = '') -> str:
    params = {'source': source, 'v': poster_scope(source, server_url, token)}
    if thumb:
        params['thumb'] = thumb
    if item_id:
        params['itemId'] = item_id
    if image_tag:
        params['tag'] = image_tag
    return '/api/libraries/image-proxy?' + urlencode(params)
