# Docker Deployment (Simple)

This app is designed to run as a single container that serves both:
- App UI over HTTP
- Yjs WebSocket sync on `/yjs`

No custom websocket URL config is required in normal deployments.

## Quick Start

1. Build and start:
   - `docker compose up -d --build`
2. Open:
   - `http://<server-ip>:27015`
3. Check health:
   - `http://<server-ip>:27015/healthz`

## Environment Variables

- `HOST` (default `0.0.0.0`)
- `PORT` (default `27015`)
- `YPERSISTENCE`:
  - empty/unset => relay-only (no server-side LevelDB)
  - e.g. `/data/yjs` => persistent Yjs LevelDB store
- `APP_URL` (optional):
  - used for startup logging only (helps show expected public URL)

## Reverse Proxy (if used)

If you put this behind Nginx/OpenResty/Caddy, proxy both:
- `/` -> app container
- `/yjs` -> same app container with websocket upgrade support

If `/yjs` is not proxied with upgrade headers, UI may load but status will stay `Connection: Reconnecting...`.
