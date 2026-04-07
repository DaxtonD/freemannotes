# Docker Deployment

Freeman Notes ships as a single Node container that serves the SPA, REST API, uploaded assets, and the Yjs WebSocket endpoint on the same port.

The repository now includes a Docker-ready stack for beta deployment:
- `Dockerfile` for the app image
- `docker-entrypoint.sh` for startup preparation and runtime warnings
- `docker-compose.yml` for app + PostgreSQL + Redis
- `.env.docker.example` as the deployment env template
- named volumes for PostgreSQL data and uploaded profile images

No manual Prisma step is required during normal startup. The server boot process creates the database if needed and runs the configured schema sync automatically.

## Quick Start

1. Copy the deployment env template:
   ```bash
   cp .env.docker.example .env.docker
   ```
2. Edit `.env.docker` and set at least:
   - `AUTH_JWT_SECRET`
   - `APP_URL` for your beta URL or host
   - `POSTGRES_PASSWORD`
   - `SMTP_*` values if invite email or email-mode reminder notifications should work
3. Start the stack:
   ```bash
   docker compose --env-file .env.docker up -d --build
   ```
4. Open the app:
   ```text
   http://<server-ip-or-domain>:27015
   ```
5. Verify runtime health:
   ```text
   http://<server-ip-or-domain>:27015/healthz
   http://<server-ip-or-domain>:27015/readyz
   ```

## What Persists

- PostgreSQL data in the `freemannotes-pgdata` volume
- uploaded profile images in the `freemannotes-uploads` volume

That means beta testers can restart or update the container without losing the database or uploaded avatars.

## Environment Variables

The recommended deployment path is to keep all runtime settings in `.env.docker` and pass it with `docker compose --env-file .env.docker ...`.

Important variables:

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Runtime mode for the container. Leave this at `production` for beta deployments |
| `APP_PORT` | `27015` | Host port exposed by Docker |
| `HOST` | `0.0.0.0` | Bind address inside the container |
| `PORT` | `27015` | Internal app port |
| `APP_URL` | *(unset)* | Public base URL used for invite links and startup logs |
| `POSTGRES_USER` | `freemannotes` | Username for the bundled PostgreSQL service. Only applies when you use the bundled `postgres` container |
| `POSTGRES_PASSWORD` | `freemannotes` | Password for the bundled PostgreSQL service. Change this before exposing the stack to beta users |
| `POSTGRES_DB` | `freemannotes` | Database name for the bundled PostgreSQL service |
| `DATABASE_URL` | `postgresql://...@postgres:5432/...` | Prisma connection string for the bundled PostgreSQL service or an external PostgreSQL instance |
| `DB_SCHEMA_SYNC` | `deploy` | Startup schema mode: `deploy`, `push`, or `none` |
| `DB_BASELINE_ON_NON_EMPTY` | *(unset)* | One-time recovery flag for `P3005` when a prior failed install already created FreemanNotes tables without Prisma migration history |
| `UPLOAD_DIR` | `/app/uploads` | Upload storage path inside the container |
| `PGTIMEZONE` | *(unset)* | Optional PostgreSQL display timezone |
| `AUTH_JWT_SECRET` | `change-me-before-beta` | JWT signing secret. Set a long random value before shipping |
| `AUTH_COOKIE_NAME` | `freemannotes_session` | Session cookie name. Change only if you need multiple Freeman Notes instances on the same domain |
| `AUTH_COOKIE_SECURE` | *(unset)* | Force cookies to be marked Secure. Set this when HTTPS terminates at a reverse proxy in front of the container |
| `AUTH_SESSION_DAYS` | `14` | Number of days a login session remains valid |
| `AUTH_BCRYPT_ROUNDS` | `12` | bcrypt work factor used for password hashing |
| `AUTH_ALLOW_REGISTER` | `true` | Allows open user registration |
| `REDIS_URL` | `redis://redis:6379` | Recommended for push notification bell badge reliability. Required for multi-instance/load-balanced deployments. Defaults to the bundled Redis service in `docker-compose.yml`. Set to empty to run without Redis |
| `YPERSISTENCE` | *(unset)* | Optional LevelDB-backed Yjs cache path for operators who want an extra local persistence layer alongside PostgreSQL |
| `DEBUG_LOGGING` | `0` | Enable structured server-side debug logging. Useful for beta diagnostics, but leave disabled during normal operation |
| `SMTP_HOST` | *(unset)* | SMTP host for invite mail |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | SMTP TLS mode |
| `SMTP_USER` | *(unset)* | SMTP username |
| `SMTP_PASS` | *(unset)* | SMTP password |
| `SMTP_FROM` | `Freeman Notes <no-reply@example.com>` | Sender address for invites and email-mode reminder delivery |
| `WEB_NOTIFICATION_MODE` | `auto` | External notification mode for desktop and non-Android browsers: `auto`, `push`, `email`, or `off` |
| `ANDROID_NOTIFICATION_MODE` | `auto` | External notification mode for Android browsers/PWAs: `auto`, `push`, `email`, or `off` |
| `IOS_NOTIFICATION_MODE` | `auto` | External notification mode for iOS: `auto`, `push`, `email`, or `off` |
| `VAPID_PUBLIC_KEY` | *(unset)* | VAPID public key for Web Push on desktop and Android browser/PWA clients |
| `VAPID_PRIVATE_KEY` | *(unset)* | VAPID private key matching `VAPID_PUBLIC_KEY` |
| `VAPID_SUBJECT` | *(unset)* | Contact URI for the VAPID sender, usually `mailto:...` |
| `FCM_PROJECT_ID` | *(unset)* | Firebase project id for iOS push delivery |
| `FCM_CLIENT_EMAIL` | *(unset)* | Firebase service-account client email for iOS push delivery |
| `FCM_PRIVATE_KEY` | *(unset)* | Firebase service-account private key for iOS push delivery |
| `TRASH_CLEANUP_INTERVAL_MS` | `3600000` | Server interval for scanning trashed notes that have passed their auto-delete threshold |
| `OCR_DISABLED` | `0` | Set to `1` to disable OCR processing entirely |
| `OCR_LOG_OUTPUT` | `0` | Set to `1` to stream OCR child-process output and progress messages into the container logs |
| `OCR_PYTHON_BIN` | `/opt/ocr-venv/bin/python` | Python executable used by the OCR worker inside the container |
| `PADDLE_HOME` | `/app/.paddleocr` | Writable cache directory for PaddleOCR model downloads |
| `PADDLE_PDX_MODEL_SOURCE` | `BOS` | Paddle model download source used by the bundled OCR runtime |

`VITE_*` variables are build-time frontend settings rather than runtime Docker settings. The shipping beta image does not read them from `docker compose` at container start.

## External PostgreSQL

If you already have PostgreSQL elsewhere, point `DATABASE_URL` at it and start only the app service:

```bash
docker compose --env-file .env.docker up -d --build freemannotes
```

In that mode, the bundled `postgres` service is not required.

## Reverse Proxy

If you deploy behind Nginx, Caddy, Traefik, OpenResty, or another reverse proxy, proxy both paths to the same app container:

- `/`
- `/yjs`

`/yjs` must allow WebSocket upgrades. If it does not, the UI will load but collaboration will stay stuck reconnecting.

## Operational Notes

- The bundled PostgreSQL service is not exposed on a host port by default.
- `AUTH_JWT_SECRET` should be changed before any public beta.
- For invite emails or email-mode reminders, configure `APP_URL` and the `SMTP_*` variables together.
- Registration already requires a valid email address. That address doubles as the account identity and the destination for email-mode reminder delivery.
- `WEB_NOTIFICATION_MODE`, `ANDROID_NOTIFICATION_MODE`, and `IOS_NOTIFICATION_MODE` control external reminder/test delivery per platform:
   - `auto` prefers push and falls back to email when SMTP is configured.
   - `push` disables fallback and requires the corresponding push transport.
   - `email` bypasses push and always uses SMTP.
   - `off` disables external reminder/test delivery for that platform while leaving in-app notification badges intact.
- Web and Android browser push use VAPID. iOS push uses FCM.
- For relay-only testing, you can unset `DATABASE_URL`, but that is not recommended for beta because server-side persistence is disabled.

## Recovering From P3005 After A Failed First Install

If a previous container run created FreemanNotes tables before migrations were fully baselined, later production starts may fail with `P3005` because `prisma migrate deploy` sees a non-empty database with no Prisma migration history.

For a FreemanNotes database that you want to keep, set this once in `.env.docker`:

```text
DB_BASELINE_ON_NON_EMPTY=true
```

Then start the app once. The container will:

- run `prisma db push --skip-generate`
- mark the committed migrations as already applied
- retry `prisma migrate deploy`

After that startup succeeds, remove `DB_BASELINE_ON_NON_EMPTY` again. If the database contains no data you care about, deleting the database or volume and letting the app recreate it is simpler.
