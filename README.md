# FreemanNotes

FreemanNotes is my "Google Keep, but let me actually do the stuff I keep wishing it could do" project.

I love Google Keep. I use it a lot. But I kept running into the same wall: I wanted workspaces, collections, real self-hosting, better media support, markdown-friendly writing, document attachments, richer collaboration, and a note app that does not panic the second the network gets weird. So I built the note app my inner tinkering goblin wanted.

The "Freeman" part is the other half of my brain. I also love Half-Life 2, and Gordon Freeman has the exact kind of silent "fine, I'll solve it myself" energy that feels correct for a self-hosted notes app. So this became Freeman Notes: part Keep-inspired scratchpad, part Black Mesa lab notebook.

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
- Workspaces and nested Collections organization.
- Drag-and-drop masonry note grid with improved cross-device ordering persistence.
- Note collaboration with roles for owners, admins, editors, and viewers.
- Workspace invites, note collaboration flows, and in-app notifications.
- Rich note-card previews that understand formatted content instead of flattening everything into sad plain text.
- Image uploads, galleries, fullscreen viewers, and OCR-backed search support for note images.
- Document attachments with in-app browsing, generated previews and extracted text.
- URL previews with stored metadata, preview cards, and failure notifications when a site refuses to cooperate.
- Aggregate attachment chips on note cards for attachments, collaborators, labels and collections.
- Search across notes, OCR text, collaborators, links, and documents.
- Theme and language preferences, plus per-device UI preferences.
- Mobile-aware editor and modal behavior, including better scroll locking and overlay handling.

## Why I Built It

The short version is: I wanted Google Keep with more gears exposed.

I wanted:

- Workspaces instead of one flat pile of thoughts.
- Collections, Workspaces and better structure.
- Images and documents as real first-class note content.
- Markdown-friendly writing instead of fighting a text box.
- Self-hosting because sometimes I want my notes to live on my machine, not somebody else's product roadmap.
- Collaboration without giving up offline-first behavior.
- A note app that feels like a tool, not a trap.

## Tech Stack

- Frontend: React, TypeScript, Vite.
- Collaboration and offline merge model: Yjs.
- Backend: Node.js, Prisma, PostgreSQL.
- Cache/pub-sub: Redis (bundled, recommended).
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
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` if you want invite emails or email-mode reminder notifications

For the full Docker and `.env.docker` variable matrix, including notification, OCR, Redis, and recovery flags, see `DEPLOYMENT.md`.

Then start the stack:

```bash
docker compose --env-file .env.docker up -d --build
```

What this gives you:

- The app on `http://localhost:27015`
- PostgreSQL 16 with a persistent named volume
- Redis for push notification bell badge delivery and workspace pub/sub
- A persistent uploads volume for images and documents
- Automatic Prisma migration deploy on startup
- OCR runtime in the main app container for image/document processing

Useful checks:

```text
http://localhost:27015/healthz
http://localhost:27015/readyz
```

Redis is included in `docker-compose.yml` and enabled by default. It handles in-process pub/sub so the notification bell badge updates immediately when a reminder fires. It is also required if you run multiple app instances behind a load balancer. To disable Redis, set `REDIS_URL=` (empty string) and remove the `redis` service from `docker-compose.yml`.

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

- `REDIS_URL` — recommended; set to `redis://your-redis-host:6379` for push notification bell badge updates and multi-instance pub/sub
- `PGTIMEZONE`
- `DB_BASELINE_ON_NON_EMPTY=true` for one startup if a previous failed install already created tables and Prisma now exits with `P3005`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `OCR_DISABLED=1` if you intentionally want to disable OCR
- `OCR_LOG_OUTPUT=1` if you want OCR child-process output and progress logs in the server logs

### External Notifications (optional)

FreemanNotes supports per-platform external notification delivery for reminder notifications and test notifications from Preferences:

- `WEB_NOTIFICATION_MODE` for desktop and non-Android browsers
- `ANDROID_NOTIFICATION_MODE` for Android browsers and installed PWAs
- `IOS_NOTIFICATION_MODE` for iOS

Each mode accepts:

- `auto` — use push when that platform is configured, otherwise fall back to email if SMTP is configured
- `push` — require push only
- `email` — require email only
- `off` — disable external reminder/test notifications on that platform

User registration already requires a valid email address. That email is used both as the account identifier and as the destination for email-mode reminder delivery.

**SMTP (required for any `email` or `auto` fallback path):**

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@example.com
SMTP_PASS=your-password
SMTP_FROM="Freeman Notes <no-reply@example.com>"
```

**VAPID keys (Web / Android browser/PWA push):**

```bash
npx web-push generate-vapid-keys
```

Copy the output into your `.env`:

```
VAPID_PUBLIC_KEY=<base64url public key>
VAPID_PRIVATE_KEY=<base64url private key>
VAPID_SUBJECT=mailto:admin@yourdomain.com
```

**FCM (iOS push):**

1. Open [Firebase Console](https://console.firebase.google.com/) → your project → Project Settings → Service Accounts.
2. Click **Generate new private key** and download the JSON file.
3. Copy three fields from the JSON into your `.env`:

```
FCM_PROJECT_ID=your-firebase-project-id
FCM_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FCM_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
```

**Example configurations:**

- Web push + Android push + iOS push: set all three `*_NOTIFICATION_MODE=push`, configure both VAPID and FCM
- Web push + Android push + iOS email fallback: set `WEB_NOTIFICATION_MODE=push`, `ANDROID_NOTIFICATION_MODE=push`, `IOS_NOTIFICATION_MODE=auto`, configure VAPID + SMTP
- Web email + Android email + iOS email: set all three `*_NOTIFICATION_MODE=email`, configure SMTP only
- External notifications off everywhere: set all three `*_NOTIFICATION_MODE=off`

The Notifications panel in Preferences shows the effective delivery mode for the current platform so users can see whether they are using push, email fallback, or no external delivery at all.

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
| `REDIS_URL` | recommended for push notification bell reliability and required for multi-instance deployments |
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
