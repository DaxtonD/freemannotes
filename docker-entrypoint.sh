#!/bin/sh
set -eu

UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

mkdir -p "$UPLOAD_DIR"

WRITE_TEST_PATH="$UPLOAD_DIR/.freemannotes-write-test"
if touch "$WRITE_TEST_PATH" 2>/dev/null; then
	rm -f "$WRITE_TEST_PATH"
else
	echo "[entrypoint] Warning: UPLOAD_DIR is not writable by uid $(id -u):gid $(id -g): $UPLOAD_DIR" >&2
fi

if [ "${NODE_ENV:-production}" = "production" ] && [ "${AUTH_JWT_SECRET:-}" = "change-me-before-beta" ]; then
	echo "[entrypoint] Warning: AUTH_JWT_SECRET is still using the default beta placeholder." >&2
fi

echo "[entrypoint] Starting FreemanNotes on ${HOST:-0.0.0.0}:${PORT:-27015}"

exec "$@"