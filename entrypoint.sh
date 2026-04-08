#!/bin/bash
set -e

# Set defaults if not provided
PUID=${PUID:-1000}
PGID=${PGID:-1000}

# Adjust UID/GID of the internal app user
groupmod -o -g "${PGID}" appgroup
usermod -o -u "${PUID}" appuser

# Ensure app data dir is owned by appuser:appgroup
chown -R appuser:appgroup /app

# Exec gunicorn as the appuser via su-exec
exec gosu appuser:appgroup "$@"
