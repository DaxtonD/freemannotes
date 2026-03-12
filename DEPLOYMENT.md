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
   - `SMTP_*` values if invite email should work
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
| `AUTH_JWT_SECRET` | `change-me-before-beta` | JWT signing secret. Set a long random value before shipping |
| `AUTH_ALLOW_REGISTER` | `true` | Allows open user registration |
| `UPLOAD_DIR` | `/app/uploads` | Upload storage path inside the container |
| `PGTIMEZONE` | *(unset)* | Optional PostgreSQL display timezone |
| `REDIS_URL` | *(unset)* | Optional Redis cache URL |
| `SMTP_HOST` | *(unset)* | SMTP host for invite mail |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | `false` | SMTP TLS mode |
| `SMTP_USER` | *(unset)* | SMTP username |
| `SMTP_PASS` | *(unset)* | SMTP password |
| `SMTP_FROM` | `FreemanNotes <no-reply@example.com>` | Sender address for invites |

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
- For invite emails, configure `APP_URL` and the `SMTP_*` variables together.
- For relay-only testing, you can unset `DATABASE_URL`, but that is not recommended for beta because server-side persistence is disabled.
