# Freeman Notes

Freeman Notes exists because I got tired of trying to find a notes app that I wanted.
One app forced me into split-pane markdown.
One was secure, but isolated and didn't allow collaboration. 

I've been using Google Keep ever since it was released. I love it. It's so quick and easy to take a note.
That feeling stuck with me. Everything else didn’t, So I stopped looking And built what I actually wanted.
It started out a making a simple Google Keep clone. Then exploded to include all the features I felt were lacking.
---

## Why "Freeman"?

Two reasons:

* **Free** — Apps should be free, simple, fast, and yours
* **Freeman** — My love for Half-Life and because sometimes the right answer is:
  *"fine… I’ll solve it myself."*

---

## What This Is

Freeman Notes is a self-hosted, offline-first notes app that stays out of your way.

You open it. You write. It works.
Simple when you want it to be, but a TON of capability underneath.

Built with:

* React + TypeScript
* Yjs (real-time + offline sync)
* PostgreSQL + Prisma
* Gotenberg for document conversion
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
* Link previews
* Documents with sync'd markup
* Search across *everything*
* Fully self-hosted

---

## Why I’m Sharing This

This started as a small personal project and then it turned into a year of work and endless nights. 

Time away from other projects, work, family..
And I’m still going because I think this can be something genuinely solid.

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
* Gotenberg available as an opt-in profile for office-to-PDF (see [Document Conversion](#document-conversion-optional))

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
  ghcr.io/daxtond/freemannotes:latest
```

Optional:

* `REDIS_URL` (recommended)
* `GOTENBERG_URL` — office documents open in the in-app viewer (see [Document Conversion](#document-conversion-optional))
* `SMTP_*` settings
* `OCR_DISABLED=1`
* `IMAGE_CAPTURE_MAX_DIMENSION_PX` / `IMAGE_CAPTURE_JPEG_QUALITY` — image quality ceiling for uploads and in-app camera capture. Defaults to 2560px / 0.82 (~0.5MB per photo — budget that × images-per-user × user-count for your uploads volume). Raise or lower to trade image sharpness against storage/bandwidth for your deployment's size. Only affects new uploads.
* `DOCUMENT_UPLOAD_MAX_MB` — largest document upload in MB (default 100). Raise it for big print sets, and raise your reverse proxy's upload limit to match (Cloudflare's free plan caps requests at 100 MB).

---

## Install on Unraid

Works as a standard custom container:

* Repository: `ghcr.io/daxtond/freemannotes:latest` (or pin a release, e.g. `ghcr.io/daxtond/freemannotes:1.16.0`)
* Port: `27015`
* AppData: `/app/uploads`
* Set:

  * `DATABASE_URL`
  * `AUTH_JWT_SECRET`
  * `APP_URL`
  * `AUTH_COOKIE_SECURE=true` if the public URL is HTTPS

Optional but recommended:

  * `REDIS_URL`
  * `GOTENBERG_URL` (install Gotenberg from Community Applications; see [Document Conversion](#document-conversion-optional))
  * `SMTP_*`
  * `WEB_NOTIFICATION_MODE` / `ANDROID_NOTIFICATION_MODE` / `IOS_NOTIFICATION_MODE`
  * `VAPID_*` and `FCM_*` when push notifications are enabled

The included Unraid template lives at `third-party/freemannotes.xml`.

If you use a reverse proxy:

* Make sure `/yjs` supports WebSocket upgrades

---

## Document Conversion (Optional)

Word, Excel, PowerPoint and OpenDocument files can open in the same in-app viewer as PDFs (zoom, page panel, search) when a [Gotenberg](https://gotenberg.dev) container is available. Like Redis, it's optional:

* **Without it:** office files still upload, sync, work offline and download. Opening one shows its text.
* **With it:** each office file gets a PDF copy made in the background. Downloads still give you the original file.

Docker Compose ships Gotenberg as an opt-in profile:

```bash
docker compose --env-file .env.docker --profile gotenberg up -d
```

and in `.env.docker`:

```env
GOTENBERG_URL=http://gotenberg:3000
```

On Unraid, install Gotenberg from Community Applications and set `GOTENBERG_URL` on Freeman Notes to `http://<server-ip>:<gotenberg-port>`.

Existing office files convert automatically the first time the server starts with `GOTENBERG_URL` set, and the server log says whether Gotenberg is connected. If Gotenberg goes down, files simply wait and conversion picks up again when it's back.

Security: Gotenberg has no login by default, and its Chromium routes can fetch any web address. Don't publish its port to the internet. The bundled Compose service keeps it on the internal network and starts it with `--chromium-disable-routes=true`. If other machines can reach it, turn on its basic auth (`--api-enable-basic-auth` with `GOTENBERG_API_BASIC_AUTH_USERNAME` / `GOTENBERG_API_BASIC_AUTH_PASSWORD`) and set `GOTENBERG_USERNAME` / `GOTENBERG_PASSWORD` on Freeman Notes.

---

## Notifications (Optional)

Supports:

* Web push
* Android PWA push
* iOS push (via FCM) + a annual monetary fee because this is Apple.
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
Easy. Set up a developer account and pay Apple a bunch of money every year
just so you can send a notification to your device. 

```
FCM_PROJECT_ID=...
FCM_CLIENT_EMAIL=...
FCM_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

---

## Local Development

Requires **Node 20+**, **PostgreSQL 14+**, and Docker if you want the database in a container. Python 3 is only needed for OCR.

```bash
git clone https://github.com/DaxtonD/freemannotes.git
cd freemannotes

# --legacy-peer-deps is required, not optional: y-excalidraw pins an older
# @excalidraw/excalidraw than this project uses, and a plain `npm install` aborts.
npm ci --legacy-peer-deps

# A throwaway database matching the defaults in .env.example. The Compose
# postgres service deliberately publishes no host port, so it can't be reached
# from a dev server running outside Docker — use this instead.
docker run -d \
  --name freemannotes-dev-db \
  -p 5432:5432 \
  -e POSTGRES_USER=freemannotes \
  -e POSTGRES_PASSWORD=freemannotes \
  -e POSTGRES_DB=freemannotes \
  postgres:16-alpine

cp .env.example .env
cp env.vite/.env.example env.vite/.env.development   # optional

npm run dev
```

That gives you:

* Vite dev server on **http://localhost:5173**
* API + Yjs WebSocket on **http://localhost:27016**, which Vite proxies to, exactly as production does

The schema is created and migrated automatically on startup — `npm run dev` runs the database init itself, and `postinstall` generates the Prisma client. You only need `npm run db:migrate` by hand after pulling changes that add a migration while the server is already running.

To run the production build locally instead, `npm start` builds the frontend and serves everything from **http://localhost:27015**.

---

## The Goal

A notes app that feels effortless at first but doesn’t fall apart when you expect more from it.


---

## Final Note

This isn’t trying to be everything.

It’s trying to be *right*.

And yeah… it ships with a crowbar.


## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DaxtonD/freemannotes&type=Date)](https://star-history.com/#DaxtonD/freemannotes&Date)
