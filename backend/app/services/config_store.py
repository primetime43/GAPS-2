import base64
import copy
import hashlib
import json
import logging
import os
import platform
import sys
import threading
import uuid

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_KEY_ENV_VAR = 'GAPS2_CONFIG_KEY'

# Serializes the read-modify-write in put/remove so concurrent writers
# (request thread + scheduled-scan thread + scan-completion thread) can't
# clobber each other's keys.
_WRITE_LOCK = threading.Lock()


def _get_base_dir():
    """Return the backend root, works both normally and in a PyInstaller bundle."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.dirname(__file__)))


_DATA_DIR = os.path.join(_get_base_dir(), 'data')
_CONFIG_FILE = os.path.join(_DATA_DIR, 'config.enc')
_KEY_FILE = os.path.join(_DATA_DIR, '.config.key')


def _ensure_dir():
    os.makedirs(_DATA_DIR, exist_ok=True)


def data_dir() -> str:
    """Return the data directory path, creating it if needed.

    Exposed for other services that need to persist sidecar files (e.g. a
    plain-JSON cache) into the same directory that holds config.enc.
    """
    _ensure_dir()
    return _DATA_DIR


def _legacy_machine_key() -> bytes:
    """Pre-keyfile key derived from hostname + MAC.

    Kept only as a one-time migration fallback so installs that pre-date the
    keyfile can still decrypt their existing config.enc. Container deployments
    broke under this scheme because hostname and MAC change on every recreate
    (issue #36), so new installs use a random keyfile instead.
    """
    node = platform.node()
    mac = hex(uuid.getnode())
    seed = f"gaps2-{node}-{mac}".encode()
    digest = hashlib.sha256(seed).digest()
    return base64.urlsafe_b64encode(digest[:32])


def _load_keyfile():
    if not os.path.isfile(_KEY_FILE):
        return None
    try:
        with open(_KEY_FILE, 'rb') as f:
            return f.read().strip()
    except OSError as e:
        logger.warning("Failed to read keyfile %s: %s", _KEY_FILE, e)
        return None


def _write_keyfile(key: bytes) -> None:
    _ensure_dir()
    with open(_KEY_FILE, 'wb') as f:
        f.write(key)
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        # Windows chmod is best-effort; the key file still lives in a user-owned dir.
        pass


def _resolve_key():
    """Return (active_fernet_key, allow_legacy_migration).

    Resolution order:
      1. GAPS2_CONFIG_KEY env var — explicit override for advanced deployments.
      2. Existing keyfile at <data>/.config.key.
      3. Generate a new random key and persist it.
    """
    env_key = os.environ.get(_KEY_ENV_VAR)
    if env_key:
        return env_key.encode(), True

    existing = _load_keyfile()
    if existing:
        return existing, False

    new_key = Fernet.generate_key()
    _write_keyfile(new_key)
    logger.info("Generated new config encryption key at %s", _KEY_FILE)
    return new_key, True


_active_key, _allow_legacy_migration = _resolve_key()
_fernet = Fernet(_active_key)
_legacy_fernet = Fernet(_legacy_machine_key())

# In-memory cache of the decrypted config. config.enc is only written through
# save() within this process, so the cache stays authoritative — we refresh it
# on every write rather than expiring it. This avoids re-reading and
# Fernet-decrypting the whole blob (which holds last_scan's full gap list and
# scan_history) on every get(), a hot path during scans and per request.
# `None` means "not loaded yet". `_cache_lock` guards the reference swap.
_cache: dict | None = None
_cache_lock = threading.Lock()


def _read_and_decrypt() -> dict:
    """Read and decrypt config.enc from disk (no caching), or return {}.

    Includes the one-time legacy-key migration. Uses `_encrypt_and_write`
    (not the public `save`) for that rewrite so it never touches the cache or
    re-enters `_cache_lock`.
    """
    if not os.path.isfile(_CONFIG_FILE):
        return {}
    try:
        with open(_CONFIG_FILE, 'rb') as f:
            encrypted = f.read()
    except OSError as e:
        logger.warning("Failed to read config file: %s", e)
        return {}

    try:
        return json.loads(_fernet.decrypt(encrypted))
    except InvalidToken:
        pass
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse decrypted config: %s", e)
        return {}

    if _allow_legacy_migration:
        try:
            data = json.loads(_legacy_fernet.decrypt(encrypted))
        except (InvalidToken, json.JSONDecodeError):
            logger.warning(
                "Could not decrypt %s with current or legacy key. "
                "Delete the file and reconfigure from the UI if this is unexpected.",
                _CONFIG_FILE,
            )
            return {}
        logger.info("Migrated config.enc from legacy machine-bound key to keyfile.")
        _encrypt_and_write(data)
        return data

    logger.warning(
        "Could not decrypt %s with the configured key. "
        "Delete the file and reconfigure from the UI if this is unexpected.",
        _CONFIG_FILE,
    )
    return {}


def _encrypt_and_write(data: dict) -> None:
    """Encrypt and atomically write the full config dict to disk (no caching)."""
    _ensure_dir()
    plaintext = json.dumps(data).encode()
    encrypted = _fernet.encrypt(plaintext)
    tmp = _CONFIG_FILE + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(encrypted)
    # Restrict to owner-only read/write so other users on a shared host
    # (or other containers on a shared volume) can't read the encrypted blob.
    # Set on the temp file before the rename so the destination never exists
    # with looser permissions.
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        # Windows has a limited chmod; best-effort — encryption still protects contents.
        pass
    os.replace(tmp, _CONFIG_FILE)


def load() -> dict:
    """Return the decrypted config, cached in memory after the first read.

    Hands out a deep copy so callers can mutate their result freely (matching
    the pre-cache behavior, where every load() re-parsed a fresh dict) without
    corrupting the shared cache.
    """
    global _cache
    with _cache_lock:
        cached = _cache
    if cached is None:
        # Decrypt outside the lock (it may rewrite the file during migration);
        # then publish, preferring any cache a concurrent save() already set.
        fresh = _read_and_decrypt()
        with _cache_lock:
            if _cache is None:
                _cache = fresh
            cached = _cache
    return copy.deepcopy(cached)


def save(data: dict) -> None:
    """Encrypt and save the full config dict to disk via atomic rename, then
    refresh the in-memory cache.

    The temp-file + os.replace dance means a concurrent reader either sees
    the pre-save file or the post-save file, never a half-written blob.
    """
    global _cache
    _encrypt_and_write(data)
    with _cache_lock:
        _cache = copy.deepcopy(data)


def get(key: str, default=None):
    return load().get(key, default)


def put(key: str, value) -> None:
    with _WRITE_LOCK:
        data = load()
        data[key] = value
        save(data)


def remove(key: str) -> None:
    with _WRITE_LOCK:
        data = load()
        data.pop(key, None)
        save(data)
