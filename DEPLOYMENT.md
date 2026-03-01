# Docker Deployment

This app is designed to run as a single container that serves both:
- App UI over HTTP
- Yjs WebSocket sync on `/yjs`
- REST API at `/api/*` (when PostgreSQL is configured)

No custom websocket URL config is required in normal deployments.

## Quick Start (with PostgreSQL)

1. Build and start (includes PostgreSQL):
   ```bash
   docker compose up -d --build
   ```
2. Run database migrations on first boot:
   ```bash
   docker compose exec freemannotes npx prisma migrate deploy
   # or for quick schema push (no migration history):
   docker compose exec freemannotes npx prisma db push
   ```
3. Open: `http://<server-ip>:27015`
4. Check health: `http://<server-ip>:27015/healthz`
5. Check readiness: `http://<server-ip>:27015/readyz`

## Quick Start (Relay-Only, No Database)

If you don't want PostgreSQL persistence, omit `DATABASE_URL`:

1. Build and start:
   ```bash
   docker compose up -d --build freemannotes
   ```
2. Open: `http://<server-ip>:27015`

In relay-only mode, documents only exist in browser IndexedDB and in-memory on the server while clients are connected.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `27015` | HTTP + WebSocket port |
| `DATABASE_URL` | *(unset)* | PostgreSQL connection string. When set, enables server-side Yjs doc persistence via Prisma. Format: `postgresql://USER:PASS@HOST:PORT/DB?schema=public` |
| `REDIS_URL` | *(unset)* | Optional Redis URL for doc-state caching. Format: `redis://HOST:PORT` |
| `YPERSISTENCE` | *(unset)* | Legacy LevelDB persistence path (superseded by `DATABASE_URL`) |
| `APP_URL` | *(unset)* | Public base URL, used for startup logging only |

### Persistence Modes

1. **PostgreSQL** (`DATABASE_URL` set) — Recommended. Yjs documents are durably persisted to PostgreSQL via Prisma. Survives server restarts. Optional Redis cache layer for faster loads.
2. **LevelDB** (`YPERSISTENCE=/data/yjs`) — Legacy. Uses y-websocket's built-in LevelDB. Useful for simple single-node deployments.
3. **Relay-only** (neither set) — No server-side persistence. Documents live only in browser IndexedDB.

## REST API Endpoints

Available when `DATABASE_URL` is set:

| Endpoint | Method | Description |
|---|---|---|
| `/healthz` | GET | Health check (always available) |
| `/readyz` | GET | Readiness check (DB + workspace initialized) |
| `/api/workspace` | GET | Active workspace metadata |
| `/api/docs` | GET | List all persisted documents with sizes |
| `/api/docs/:docId` | GET | Decoded snapshot of a single document |

## Reverse Proxy (if used)

If you put this behind Nginx/OpenResty/Caddy, proxy both:
- `/` -> app container
- `/yjs` -> same app container with websocket upgrade support

If `/yjs` is not proxied with upgrade headers, UI may load but status will stay `Connection: Reconnecting...`.

## Redis (Optional)

To enable Redis caching, uncomment the `redis` service in `docker-compose.yml` and set `REDIS_URL`:

```yaml
environment:
  REDIS_URL: redis://redis:6379
```

Redis provides:
- Faster doc-state loads (cached binary snapshots with 24h TTL)
- Foundation for multi-instance pub/sub coordination (future)
