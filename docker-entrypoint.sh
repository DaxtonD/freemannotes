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

if [ "${OCR_DISABLED:-0}" != "1" ]; then
	if [ ! -x "${OCR_PYTHON_BIN:-}" ]; then
		echo "[entrypoint] Warning: OCR_PYTHON_BIN is not executable: ${OCR_PYTHON_BIN:-<unset>}" >&2
	elif ! "$OCR_PYTHON_BIN" /app/server/ocrRunner.py --self-check >/tmp/freemannotes-ocr-check.json 2>/tmp/freemannotes-ocr-check.err; then
		echo "[entrypoint] Warning: OCR runtime self-check failed." >&2
		cat /tmp/freemannotes-ocr-check.json >&2 || true
		cat /tmp/freemannotes-ocr-check.err >&2 || true
	fi
	if [ -d "${PADDLE_HOME:-}" ] && [ ! -w "${PADDLE_HOME:-}" ]; then
		echo "[entrypoint] Warning: PADDLE_HOME is not writable by uid $(id -u):gid $(id -g): ${PADDLE_HOME:-}" >&2
	fi
fi

echo "[entrypoint] Starting FreemanNotes on ${HOST:-0.0.0.0}:${PORT:-27015}"

exec "$@"