# Docker Deployment

FreemanNotes ships as a single Node container that serves the SPA, REST API, uploaded assets, and the Yjs WebSocket endpoint on the same port.

The repository now includes a Docker-ready stack for beta deployment:
- `Dockerfile` for the app image
- `docker-entrypoint.sh` for startup preparation and runtime warnings
- `docker-compose.yml` for app + PostgreSQL
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
| `APP_PORT` | `27015` | Host port exposed by Docker |
| `HOST` | `0.0.0.0` | Bind address inside the container |
| `PORT` | `27015` | Internal app port |
| `APP_URL` | *(unset)* | Public base URL used for invite links and startup logs |
| `DATABASE_URL` | `postgresql://...@postgres:5432/...` | Prisma connection string for the bundled PostgreSQL service or an external PostgreSQL instance |
| `DB_SCHEMA_SYNC` | `deploy` | Startup schema mode: `deploy`, `push`, or `none` |
| `DB_BASELINE_ON_NON_EMPTY` | *(unset)* | One-time recovery flag for `P3005` when a prior failed install already created FreemanNotes tables without Prisma migration history |
| `AUTH_JWT_SECRET` | `change-me-before-beta` | JWT signing secret. Set a long random value before shipping |
| `AUTH_ALLOW_REGISTER` | `true` | Allows open user registration |
| `UPLOAD_DIR` | `/app/uploads` | Upload storage path inside the container |
| `PGTIMEZONE` | *(unset)* | Optional PostgreSQL display timezone |
| `REDIS_URL` | `redis://redis:6379` | Recommended for push notification bell badge reliability. Required for multi-instance/load-balanced deployments. Defaults to the bundled Redis service in `docker-compose.yml`. Set to empty to run without Redis |
| `SMTP_HOST` | *(unset)* | SMTP host for invite mail |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | SMTP TLS mode |
| `SMTP_USER` | *(unset)* | SMTP username |
| `SMTP_PASS` | *(unset)* | SMTP password |
| `SMTP_FROM` | `FreemanNotes <no-reply@example.com>` | Sender address for invites and email-mode reminder delivery |
| `WEB_NOTIFICATION_MODE` | `auto` | External notification mode for desktop and non-Android browsers: `auto`, `push`, `email`, or `off` |
| `ANDROID_NOTIFICATION_MODE` | `auto` | External notification mode for Android browsers/PWAs: `auto`, `push`, `email`, or `off` |
| `IOS_NOTIFICATION_MODE` | `auto` | External notification mode for iOS: `auto`, `push`, `email`, or `off` |
| `OCR_DISABLED` | `0` | Set to `1` to disable OCR processing entirely |
| `OCR_LOG_OUTPUT` | `0` | Set to `1` to stream OCR child-process output and progress messages into the container logs |

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
