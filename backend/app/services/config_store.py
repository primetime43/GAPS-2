import base64
import hashlib
import json
import os
import platform
import uuid

from cryptography.fernet import Fernet, InvalidToken

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')
_CONFIG_FILE = os.path.join(_DATA_DIR, 'config.enc')


def _get_machine_key() -> bytes:
    """Derive a Fernet key from stable machine-specific identifiers.

    Combines the OS node name and MAC address so the encrypted config
    cannot be decrypted on a different machine.
    """
    node = platform.node()
    mac = hex(uuid.getnode())
    seed = f"gaps2-{node}-{mac}".encode()
    digest = hashlib.sha256(seed).digest()
    return base64.urlsafe_b64encode(digest[:32])


def _ensure_dir():
    os.makedirs(_DATA_DIR, exist_ok=True)


_fernet = Fernet(_get_machine_key())


def load() -> dict:
    """Load and decrypt the persisted config, or return empty dict."""
    if not os.path.isfile(_CONFIG_FILE):
        return {}
    try:
        with open(_CONFIG_FILE, 'rb') as f:
            encrypted = f.read()
        decrypted = _fernet.decrypt(encrypted)
        return json.loads(decrypted)
    except (InvalidToken, json.JSONDecodeError, OSError):
        return {}


def save(data: dict) -> None:
    """Encrypt and save the full config dict to disk."""
    _ensure_dir()
    plaintext = json.dumps(data).encode()
    encrypted = _fernet.encrypt(plaintext)
    with open(_CONFIG_FILE, 'wb') as f:
        f.write(encrypted)


def get(key: str, default=None):
    return load().get(key, default)


def put(key: str, value) -> None:
    data = load()
    data[key] = value
    save(data)


def remove(key: str) -> None:
    data = load()
    data.pop(key, None)
    save(data)
