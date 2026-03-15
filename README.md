# FreemanNotes

FreemanNotes is my "Google Keep, but let me actually do the stuff I keep wishing it could do" project.

I love Google Keep. I use it a lot. But I kept running into the same wall: I wanted workspaces, collections, real self-hosting, better media support, markdown-friendly writing, document attachments, richer collaboration, and a note app that does not panic the second the network gets weird. So I built the note app my inner tinkering goblin wanted.

The "Freeman" part is the other half of my brain. I also love Half-Life 2, and Gordon Freeman has the exact kind of silent "fine, I'll solve it myself" energy that feels correct for a self-hosted notes app. So this became FreemanNotes: part Keep-inspired scratchpad, part Black Mesa lab notebook.

## What It Is

FreemanNotes is a self-hosted, offline-first notes app built with React, TypeScript, Yjs, PostgreSQL, Prisma, and a small amount of stubbornness.

It is designed to feel quick like a sticky-note app, but without being boxed into sticky-note limitations.

## Current Features

- Text notes and checklist notes.
- Rich-text editing with headings, lists, task lists, blockquotes, code blocks, tables, alignment, links, and markdown-friendly paste handling.
- Offline-first editing with IndexedDB-backed local persistence and replay queues.
- Realtime sync powered by Yjs.
- Self-hosted deployment with Docker, Docker Compose, and Unraid-friendly container settings.
- Multiple workspaces, including sharing flows and a Shared With Me workspace model.
- Collections and nested workspace organization.
- Drag-and-drop masonry note grid with improved cross-device ordering persistence.
- Note collaboration with roles for owners, admins, editors, and viewers.
- Workspace invites, note collaboration flows, and in-app notifications.
- Rich note-card previews that understand formatted content instead of flattening everything into sad plain text.
- Image uploads, galleries, fullscreen viewers, and OCR-backed search support for note images.
- Document attachments with in-app browsing, generated previews, extracted text, and PDF viewing.
- URL previews with stored metadata, preview cards, and failure notifications when a site refuses to cooperate.
- Aggregate attachment chips on note cards for images, links, and documents.
- Search across notes, OCR text, collaborators, links, and documents.
- Theme and language preferences, plus per-device UI preferences.
- Mobile-aware editor and modal behavior, including better scroll locking and overlay handling.

## Why I Built It

The short version is: I wanted Google Keep with more gears exposed.

I wanted:

- Workspaces instead of one flat pile of thoughts.
- Collections and better structure.
- Images and documents as real first-class note content.
- Markdown-friendly writing instead of fighting a text box.
- Self-hosting because sometimes I want my notes to live on my machine, not somebody else's product roadmap.
- Collaboration without giving up offline-first behavior.
- A note app that feels like a tool, not a trap.

## Tech Stack

- Frontend: React, TypeScript, Vite.
- Collaboration and offline merge model: Yjs.
- Backend: Node.js, Prisma, PostgreSQL.
- Optional cache/pub-sub: Redis.
- OCR and document/image processing: Python runtime inside the container.
- Deployment: Docker, Docker Compose, Unraid.

## Install With Docker Compose

This is the easiest full setup because it includes PostgreSQL in the stack.

```bash
git clone https://github.com/DaxtonD/freemannotes.git
cd freemannotes
cp .env.docker.example .env.docker
```

Edit `.env.docker` and set at least these values:

- `AUTH_JWT_SECRET`
- `POSTGRES_PASSWORD`
- `APP_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` if you want invite emails

Then start the stack:

```bash
docker compose --env-file .env.docker up -d --build
```

What this gives you:

- The app on `http://localhost:27015`
- PostgreSQL 16 with a persistent named volume
- A persistent uploads volume for images and documents
- Automatic Prisma migration deploy on startup
- OCR runtime in the main app container for image/document processing

Useful checks:

```text
http://localhost:27015/healthz
http://localhost:27015/readyz
```

Optional Redis:

- Uncomment the `redis` service in `docker-compose.yml`
- Set `REDIS_URL=redis://redis:6379`

## Install With Docker

If you already have PostgreSQL somewhere else, run the app container directly.

Example:

```bash
docker run -d \
  --name freemannotes \
  -p 27015:27015 \
  -v freemannotes-uploads:/app/uploads \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=27015 \
  -e APP_URL=http://your-server:27015 \
  -e AUTH_JWT_SECRET=replace-this-with-a-real-secret \
  -e DATABASE_URL=postgresql://user:password@your-postgres-host:5432/freemannotes?schema=public \
  ghcr.io/daxtond/freemannotes:latest
```

Optional environment variables you may want:

- `REDIS_URL`
- `PGTIMEZONE`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `OCR_DISABLED=1` if you intentionally want to disable OCR

Startup behavior:

- The container creates the database if permissions allow it.
- `prisma migrate deploy` runs automatically in production mode.
- The app serves the frontend, API, uploads, and Yjs websocket endpoint on the same port.

## Install On Unraid

If you use Unraid, FreemanNotes works fine as a normal custom container.

Suggested setup:

1. Use repository `ghcr.io/daxtond/freemannotes:latest`.
2. Map port `27015` on the host to container port `27015`.
3. Map a persistent path or volume to `/app/uploads`.
4. Point `DATABASE_URL` at your PostgreSQL instance.
5. Set `AUTH_JWT_SECRET` to something long and random.
6. Set `APP_URL` to your public or LAN URL.

Recommended Unraid fields:

| Field | Value |
|---|---|
| Repository | `ghcr.io/daxtond/freemannotes:latest` |
| WebUI | `http://[IP]:[PORT:27015]` |
| Port | `27015` -> `27015` |
| AppData mapping | `/app/uploads` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://user:pass@your-postgres-host:5432/freemannotes?schema=public` |
| `AUTH_JWT_SECRET` | your generated secret |
| `APP_URL` | `http://your-unraid-ip:27015` or your domain |
| `REDIS_URL` | optional |
| `PGTIMEZONE` | optional |

Reverse proxy note:

- If you proxy FreemanNotes through Nginx, Traefik, Caddy, or similar, make sure `/yjs` supports websocket upgrades.

## Local Development

```bash
npm install
docker compose up postgres -d
cp .env.example .env
npm run dev
```

Helpful scripts:

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:migrate:deploy`
- `npm run db:migrate:status`
- `npm run db:push`
- `npm run db:init`

## Planned Features

- Collaborative drawings.
- Image labels and better image organization.
- More document workflows and richer previews.
- More search and filtering depth.
- More collaboration polish.
- More customization without turning the settings menu into a cockpit.

## Closing Pitch

If Google Keep and a Half-Life 2 obsession had a self-hosted side project child, this would be it.

FreemanNotes is for people who want quick notes, but also want folders, workspaces, images, documents, collaboration, markdown-friendly writing, offline resilience, and control over where the whole thing runs.

Basically: the sticky note, but with a crowbar and admin access.
