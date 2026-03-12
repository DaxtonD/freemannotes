#!/bin/sh
set -eu

UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

mkdir -p "$UPLOAD_DIR"

if [ "${NODE_ENV:-production}" = "production" ] && [ "${AUTH_JWT_SECRET:-}" = "change-me-before-beta" ]; then
	echo "[entrypoint] Warning: AUTH_JWT_SECRET is still using the default beta placeholder." >&2
fi

echo "[entrypoint] Starting FreemanNotes on ${HOST:-0.0.0.0}:${PORT:-27015}"

exec "$@"