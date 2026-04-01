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
	fi
	if [ -d "${PADDLE_HOME:-}" ] && [ ! -w "${PADDLE_HOME:-}" ]; then
		echo "[entrypoint] Warning: PADDLE_HOME is not writable by uid $(id -u):gid $(id -g): ${PADDLE_HOME:-}" >&2
	fi
fi

SMTP_READY=0
if [ -n "${SMTP_HOST:-}" ] && [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ] && [ -n "${SMTP_FROM:-}" ]; then
	SMTP_READY=1
fi

case "${WEB_NOTIFICATION_MODE:-auto}" in
	push|push-only)
		if [ -z "${VAPID_PUBLIC_KEY:-}" ] || [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
			echo "[entrypoint] Warning: WEB_NOTIFICATION_MODE requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." >&2
		fi
		;;
	email|email-only)
		if [ "$SMTP_READY" != "1" ]; then
			echo "[entrypoint] Warning: WEB_NOTIFICATION_MODE=email requires SMTP_HOST/USER/PASS/FROM." >&2
		fi
		;;
esac

case "${ANDROID_NOTIFICATION_MODE:-${WEB_NOTIFICATION_MODE:-auto}}" in
	push|push-only)
		if [ -z "${VAPID_PUBLIC_KEY:-}" ] || [ -z "${VAPID_PRIVATE_KEY:-}" ]; then
			echo "[entrypoint] Warning: ANDROID_NOTIFICATION_MODE requires VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY." >&2
		fi
		;;
	email|email-only)
		if [ "$SMTP_READY" != "1" ]; then
			echo "[entrypoint] Warning: ANDROID_NOTIFICATION_MODE=email requires SMTP_HOST/USER/PASS/FROM." >&2
		fi
		;;
esac

case "${IOS_NOTIFICATION_MODE:-auto}" in
	push|push-only)
		if [ -z "${FCM_PROJECT_ID:-}" ] || [ -z "${FCM_CLIENT_EMAIL:-}" ] || [ -z "${FCM_PRIVATE_KEY:-}" ]; then
			echo "[entrypoint] Warning: IOS_NOTIFICATION_MODE=push requires FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY." >&2
		fi
		;;
	email|email-only)
		if [ "$SMTP_READY" != "1" ]; then
			echo "[entrypoint] Warning: IOS_NOTIFICATION_MODE=email requires SMTP_HOST/USER/PASS/FROM." >&2
		fi
		;;
esac

echo "[entrypoint] Starting FreemanNotes on ${HOST:-0.0.0.0}:${PORT:-27015}"

exec "$@"