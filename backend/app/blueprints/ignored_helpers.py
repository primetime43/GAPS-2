"""Shared implementation of the ignored-list endpoints.

Movies (`ignored_movies`, keyed by `tmdbId`) and TV shows (`ignored_shows`,
keyed by `tvdbId`) have identical get/add/remove logic — only the config key
and the JSON field names differ. The `recommendations` and `tvdb` blueprints
keep their own thin `/ignored` routes (so each API surface stays self-evident)
and delegate the body here.
"""

from flask import jsonify, request
from app.services import config_store


def get_ignored(config_key: str):
    """Return the stored ignored-id list as ``{"ignored": [...]}``."""
    return jsonify(ignored=config_store.get(config_key, []))


def add_ignored(config_key: str, singular: str, plural: str):
    """Add one (`singular`) or many (`plural`) ids to the ignored list."""
    one, many = _read_ids(singular, plural)
    if not one and not many:
        return jsonify(error=f'{singular} or {plural} is required'), 400
    ignored = config_store.get(config_key, [])
    changed = False
    for tid in (many if many else [one]):
        if tid not in ignored:
            ignored.append(tid)
            changed = True
    if changed:
        config_store.put(config_key, ignored)
    return jsonify(result='ok')


def remove_ignored(config_key: str, singular: str, plural: str):
    """Remove one (`singular`) or many (`plural`) ids from the ignored list."""
    one, many = _read_ids(singular, plural)
    if not one and not many:
        return jsonify(error=f'{singular} or {plural} is required'), 400
    ignored = config_store.get(config_key, [])
    ids_to_remove = set(many if many else [one])
    new_ignored = [i for i in ignored if i not in ids_to_remove]
    if len(new_ignored) != len(ignored):
        config_store.put(config_key, new_ignored)
    return jsonify(result='ok')


def _read_ids(singular: str, plural: str):
    data = request.get_json() or {}
    return data.get(singular), data.get(plural, [])
