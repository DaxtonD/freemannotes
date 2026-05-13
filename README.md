# Freeman Notes

Freeman Notes exists because I got tired of compromising.

For years I went down the same rabbit hole:

* Try a new notes app
* Get excited
* Hit a wall
* Repeat

One app forced me into split-pane markdown.
One was secure, but isolated.
Another buried the actual *note-taking* behind forms and setup.

And yeah — I liked Google Keep for one reason:
open it → write → done.

That feeling stuck with me.

Everything else? Didn’t.

So I stopped looking.

And built what I actually wanted.

---

## Why "Freeman"?

Two reasons:

* **Free** — notes should be simple, fast, and yours
* **Freeman** — My love for Half-Life and because sometimes the right answer is:
  *"fine… I’ll solve it myself."*

---

## What This Is

Freeman Notes is a self-hosted, offline-first notes app that stays out of your way.

You open it.
You write.
It works.

No friction up front — but a lot of capability underneath.

Built with:

* React + TypeScript
* Yjs (real-time + offline sync)
* PostgreSQL + Prisma
* Docker / Unraid-friendly setup

And a lot of persistence.

---

## What It Does (So Far)

* Fast, no-friction note creation
* Rich text editing (without fighting you)
* Offline-first (works when your network doesn’t)
* Real-time collaboration
* Workspaces (not just one giant pile)
* Collections + labels for actual organization
* Drag-and-drop note layout
* Image support with previews and OCR search
* Document attachments with extracted text
* Link previews
* Search across *everything*
* Fully self-hosted

---

## Custom Drawing Libraries

Freeman Notes can auto-load custom Excalidraw libraries from the project itself.

- Drop `.excalidrawlib` files into `third-party/excalidraw-libraries/`
- No app restart is required just because a new file is added there
- The drawing editor picks them up through the existing library API and merges them into the Excalidraw library automatically
- The expected format is an Excalidraw library file, not a raw image

For the exact workflow and optional metadata sidecar format, see `third-party/excalidraw-libraries/README.md`.

---

## Why I’m Sharing This

This started as a personal project.

Then it turned into months of work.

Then it turned into a lot of time.

Time away from other projects.
Time away from work.
Time away from family.

And I’m still going.

Because I think this can be something genuinely solid:

* simple when you need it
* powerful when you want it

---

## Where You Come In

I can’t test everything.

I don’t have:

* iOS devices
* Safari testing
* Every edge-case setup

If you can help test, break things, suggest ideas, or contribute — I’d really appreciate it.

Even small feedback helps.

---

## Support the Project

If you like what I’m building and want to support it:

👉 https://buymeacoffee.com/DaxtonD

No pressure — but it helps justify the late nights.

---

## Install With Docker Compose (Recommended)

Full setup with PostgreSQL and Redis included:

```bash
git clone https://github.com/DaxtonD/freemannotes.git
cd freemannotes
cp .env.docker.example .env.docker
```

Edit `.env.docker` and set at least:

* `AUTH_JWT_SECRET`
* `POSTGRES_PASSWORD`
* `APP_URL`
* `AUTH_COOKIE_SECURE=true` when you are serving the app through HTTPS

Optional (recommended for notifications):

* `SMTP_HOST`
* `SMTP_PORT`
* `SMTP_USER`
* `SMTP_PASS`
* `SMTP_FROM`

Start everything:

```bash
docker compose --env-file .env.docker up -d --build
```

What you get:

* App at http://localhost:27015
* PostgreSQL with persistent storage
* Redis for pub/sub + notifications
* Persistent uploads (images + docs)
* Auto database migrations
* OCR support built-in

Before first boot you can validate the rendered stack config with:

```bash
docker compose --env-file .env.docker config
```

Health checks:

```
http://localhost:27015/healthz
http://localhost:27015/readyz
```

Deployment note:

* The web UI is served from `dist/index.html` plus `dist/assets/*`.
* If a frontend build is interrupted and leaves a partial `dist/`, the proxied root path can fail even though the Node server and health checks still return success.
* When that happens, rebuild to a fresh output directory and only then replace the live `dist/` contents.
* `/yjs` must allow WebSocket upgrades when you are behind a reverse proxy.

---

## Install With Docker (External Database)

If you already have PostgreSQL:

```bash
docker run -d \
  --name freemannotes \
  -p 27015:27015 \
  -v freemannotes-uploads:/app/uploads \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=27015 \
  -e APP_URL=http://your-server:27015 \
  -e AUTH_JWT_SECRET=replace-this \
  -e AUTH_COOKIE_SECURE=true \
  -e DATABASE_URL=postgresql://user:password@host:5432/freemannotes?schema=public \
  ghcr.io/daxtond/freemannotes:1.3.3
```

Optional:

* `REDIS_URL` (recommended)
* `SMTP_*` settings
* `OCR_DISABLED=1`

---

## Install on Unraid

Works as a standard custom container:

* Repository: `ghcr.io/daxtond/freemannotes:1.3.3` or `ghcr.io/daxtond/freemannotes:latest`
* Port: `27015`
* AppData: `/app/uploads`
* Set:

  * `DATABASE_URL`
  * `AUTH_JWT_SECRET`
  * `APP_URL`
  * `AUTH_COOKIE_SECURE=true` if the public URL is HTTPS

Optional but recommended:

  * `REDIS_URL`
  * `SMTP_*`
  * `WEB_NOTIFICATION_MODE` / `ANDROID_NOTIFICATION_MODE` / `IOS_NOTIFICATION_MODE`
  * `VAPID_*` and `FCM_*` when push notifications are enabled

The included Unraid template lives at `third-party/freemannotes.xml`.

If you use a reverse proxy:

* Make sure `/yjs` supports WebSocket upgrades

---

## Notifications (Optional)

Supports:

* Web push
* Android PWA push
* iOS push (via FCM)
* Email fallback

Modes:

* `auto`
* `push`
* `email`
* `off`

### SMTP (required for email)

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mailer@example.com
SMTP_PASS=your-password
SMTP_FROM="Freeman Notes <no-reply@example.com>"
```

### Web / Android Push (VAPID)

```bash
npx web-push generate-vapid-keys
```

Add to `.env`:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

### iOS Push (FCM)

```
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

---

## Local Development

```bash
npm install
docker compose up postgres -d
cp .env.example .env
npm run dev
```

---

## The Goal

A notes app that feels effortless at first…

…but doesn’t fall apart when you expect more from it.

Simple.
Fast.
Capable.
Yours.

---

## Final Note

This isn’t trying to be everything.

It’s trying to be *right*.

And yeah… it ships with a crowbar.


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DaxtonD/freemannotes&type=Date)](https://star-history.com/#DaxtonD/freemannotes&Date)
