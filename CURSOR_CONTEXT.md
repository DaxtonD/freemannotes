# CURSOR_CONTEXT.md

Onboarding reference for AI coding agents working on **Freeman Notes** (`freemannotes`). Generated from the actual codebase (v1.5.4). Factual only — nothing aspirational.

> **Product philosophy:** Read **`PROJECT_PHILOSOPHY.md`** first — mission, principles, and the five-question decision rule for any feature or architecture change.
>
> **Agent memory:** Copilot/Cursor institutional knowledge lives in **`memory/`** (see `memory/README.md`). Read those files **before** implementing or fixing code — especially `memory/offline-first-constraint.md`. Cursor rules in `.cursor/rules/project-memory-*.mdc` enforce this workflow.

---

## 1. Project Overview

Freeman Notes is a self-hosted, offline-first collaborative notes application. Users open the app, create notes quickly (plain text, rich text, checklists, drawings), organize them in workspaces with collections and labels, and sync in real time across devices. The server is a single Node.js process that serves the Vite-built SPA, REST APIs, and Yjs WebSocket sync, with PostgreSQL as the canonical persistence layer.

---

## 2. Repository / Folder Structure

This is **not a monorepo** — one root `package.json`. Top-level layout:

```
freemannotes/
├── src/                    # React + TypeScript frontend (App, components, core logic, sw.js)
├── server/                 # Node.js REST routers, Yjs persistence adapter, auth, push, OCR
├── prisma/                 # PostgreSQL schema and migrations
├── public/                 # Static assets (PWA icons, CardBanners, locales, legacy public/sw.js)
├── scripts/                # Build, dev wrappers, DB helpers, one-off fix scripts
├── tests/                  # Node test runner tests (minimal coverage today)
├── platforms/              # Thin Android/iOS/browser-extension clipboard conversion samples
├── third-party/            # Excalidraw custom libraries, Unraid template XML
├── env.vite/               # Vite-specific env files (.env.example, .env.development, etc.)
├── memory/                 # Agent/session notes (e.g. frontend-build.md) — not runtime code
├── svg/                    # Source SVG assets
├── dist/                   # Production build output (generated; served by server.js)
├── server.js               # Main production/dev backend entry (HTTP + Yjs WS + static)
├── ws-server.js            # Standalone minimal Yjs relay (legacy/dev; port 1234)
├── vite.config.ts          # Vite + PWA + dev-embedded Yjs WebSocket plugin
├── docker-compose.yml      # App + PostgreSQL 16 + Redis 7
├── Dockerfile              # Multi-stage build with bundled PaddleOCR runtime
└── README.md               # Product docs and setup instructions
```

---

## 3. Tech Stack

Versions from root `package.json` unless noted.

### Frontend

| Package | Version |
|---------|---------|
| react | ^19.2.4 |
| react-dom | ^19.2.4 |
| @vitejs/plugin-react | ^5.1.4 |
| vite | ^7.3.1 |
| vite-plugin-pwa | ^1.2.0 |
| typescript | ^5.9.3 |
| framer-motion | ^12.35.2 |
| @fortawesome/fontawesome-svg-core | ^7.2.0 |
| @fortawesome/react-fontawesome | ^3.2.0 |
| @tanstack/react-virtual | ^3.13.24 |
| @hello-pangea/dnd | ^18.0.1 |
| @atlaskit/pragmatic-drag-and-drop | ^1.7.9 |
| @headless-tree/core / react | ^1.6.3 |
| @excalidraw/excalidraw | ^0.18.1 |
| @tiptap/react + extensions | ^3.20.1 |
| @iamjariwala/react-doc-viewer | ^1.8.0 |
| react-easy-crop | ^5.5.3 |
| markdown-it | ^14.1.1 |
| mammoth | ^1.12.0 |
| pdf-parse | ^2.4.5 |
| xlsx | ^0.18.5 |
| heic-convert | ^2.1.0 |
| jszip | ^3.10.1 |
| turndown + turndown-plugin-gfm | ^7.2.2 / ^1.0.2 |

### Backend

| Package | Version |
|---------|---------|
| Node.js (Docker) | 20-bookworm-slim |
| dotenv | ^16.6.1 |
| bcryptjs | ^3.0.3 |
| jsonwebtoken | ^9.0.3 |
| busboy | ^1.6.0 |
| nodemailer | ^8.0.1 |
| sharp | ^0.34.5 |
| web-push | ^3.6.7 |
| qrcode | ^1.5.4 |
| ws | ^8.19.0 |
| pg | ^8.19.0 |
| @extractus/article-extractor | ^8.0.20 |

### Collaboration / CRDT

| Package | Version |
|---------|---------|
| yjs | ^13.6.29 |
| y-websocket | 2.1.0 |
| y-indexeddb | ^9.0.12 |
| y-prosemirror | ^1.3.7 |
| y-excalidraw | ^2.0.12 |
| @tiptap/extension-collaboration | ^3.20.1 |
| @tiptap/y-tiptap | ^3.0.2 |

### Database

| Package | Version |
|---------|---------|
| @prisma/client | ^5.22.0 |
| prisma | ^5.22.0 |
| PostgreSQL (docker-compose) | 16-alpine |
| ioredis | ^5.10.0 |
| Redis (docker-compose) | 7-alpine |

### Dev tooling

| Package | Version |
|---------|---------|
| concurrently | ^9.2.1 |
| ts-node | ^10.9.2 |
| @types/react | ^19.2.14 |
| @types/node | ^25.3.0 |

**External runtime (not npm):** PaddleOCR via Python 3 in Docker (`server/ocrRunner.py`). Optional locally via `OCR_PYTHON_BIN`.

---

## 4. Architecture Summary

### High-level diagram

```
Browser (React SPA)
  ├─ IndexedDB (y-indexeddb)     offline Y.Doc cache
  ├─ Service Worker (src/sw.js)  precache, API/image caching, background sync
  ├─ REST /api/*, /uploads/*     cookie JWT auth
  └─ WebSocket /yjs/<room>       Yjs sync (y-websocket)
         │
         ▼
server.js (single HTTP server, default port 27015)
  ├─ Static ./dist               SPA + hashed assets
  ├─ REST routers (server/*.js)  auth, workspaces, media, push, etc.
  ├─ WS /yjs/*                   role-aware Yjs rooms (auth required in prod)
  ├─ WS /ws/metadata             workspace metadata fan-out to connected tabs
  ├─ YjsPersistenceAdapter       PostgreSQL canonical state (+ optional Redis cache)
  └─ Schedulers                  trash cleanup, workspace cleanup, reminder push
         │
         ├─ PostgreSQL (Prisma)   Document blobs, users, media metadata, reminders
         └─ Redis (optional)      Yjs cache, pub/sub, multi-instance coordination
```

### Frontend → backend

- **Production:** Same origin. `server.js` serves `dist/` and handles `/api/*`.
- **Development:** `npm run dev` runs concurrently:
  - `dev:server` → `server.js` on **port 27016** (default via `scripts/run-dev-server.cjs`)
  - `dev:web` → Vite on **port 5173** (override: `VITE_DEV_PORT`)
- Vite proxies `/api`, `/uploads`, and optionally `/ws` to `VITE_API_PROXY_TARGET` (default `http://localhost:27016` in dev).
- Auth uses **HTTP-only JWT cookie** (`AUTH_COOKIE_NAME`, default `freemannotes_session`). Session includes `userId` and active `workspaceId`.

### Yjs sync flow

1. **Entry:** `src/main.tsx` creates `DocumentManager` with WS URL = `VITE_WS_URL` or same-origin `ws(s)://<host>/yjs`.
2. **Room naming:** Notes live in rooms like `<workspaceId>:<noteId>`. Special rooms: `<workspaceId>:__notes_registry__`, `<workspaceId>:__collections_registry__`, `<workspaceId>:__labels_registry__`.
3. **Client layers:** Each room gets a `Y.Doc`, `IndexeddbPersistence` (offline), and `WebsocketProvider` (live sync).
4. **Dev transport:** Vite **always embeds** a Yjs WebSocket server on `/yjs/*` during `vite dev` (see `yjsWebsocketPlugin` in `vite.config.ts`). This avoids needing a separate WS port behind reverse proxies.
5. **Prod transport:** `server.js` upgrades `/yjs/<room>` with auth checks (JWT cookie → workspace membership). Read-only connections enforced for VIEWER role. Server namespaces rooms if client sends unprefixed IDs.
6. **Persistence:** When `DATABASE_URL` is set, `YjsPersistenceAdapter` loads/writes `Document.state` (BYTEA) via Prisma. Debounced auto-save every 5s while editing; full write on last disconnect. Optional `YPERSISTENCE` enables legacy LevelDB via y-websocket.
7. **Note metadata:** Title, type, trash state, layout, etc. live **inside the Yjs document** (`src/core/noteModel.ts`), not as separate SQL columns.

### Service Worker

- **Source:** `src/sw.js`, built via `vite-plugin-pwa` (`injectManifest` strategy).
- **Registration:** `src/core/pwa.ts` → `initPwa()` called from `main.tsx` (not auto-injected; `injectRegister: false`).
- **Behavior:** Versioned caches for app shell, static assets, GET `/api/*` (except `/api/auth/*`), and images. Navigation fallback to `/index.html`. Background sync tag `freemannotes-background-sync`. Polls `/api/version` for update detection (important for iOS standalone PWA).
- **Dev:** PWA dev mode disabled (`devOptions.enabled: false`).

### Redis usage

Optional (`REDIS_URL`). When absent, app runs single-instance with PostgreSQL-only persistence.

| Use | Location |
|-----|----------|
| Yjs doc state cache (24h TTL) | `server/YjsPersistenceAdapter.js` |
| Workspace metadata pub/sub (`freemannotes:workspace:metadata`) | `server/workspaceMetadataEvents.js` |
| Trash cleanup cache invalidation | `server/trashCleanup.js` |
| Reminder-fired WS fan-out across instances | `server/pushService.js`, `server/pushRouter.js` |

Docker Compose comments: Redis recommended; effectively required for multi-instance HA and real-time reminder bell updates across tabs/processes.

### Ports & entry points

| Service | Port | Entry |
|---------|------|-------|
| Production app | 27015 (`PORT`) | `server.js` / `npm start` |
| Dev backend | 27016 (default) | `scripts/run-dev-server.cjs` → `server.js --watch` |
| Vite dev | 5173 | `scripts/run-dev-web.cjs` → `vite` |
| Vite preview | 4173 | `npm run preview` |
| Standalone Yjs relay | 1234 | `ws-server.js` / `npm run ws` (not used in normal dev/prod flow) |
| PostgreSQL (Docker) | 5432 | internal |
| Redis (Docker) | 6379 | internal |

### Health endpoints

- `/healthz` — always returns 200 if process is up (`server.js`)
- `/readyz` — readiness check when PostgreSQL persistence is active (`server/apiRouter.js`)
- `/api/version` — unauthenticated JSON `{ version }` for PWA update polling

---

## 5. Data Models

All models in `prisma/schema.prisma`. PostgreSQL provider. Note content/metadata is primarily in Yjs; SQL stores persistence blobs, auth, media rows, and scheduling.

### Enums

- **GlobalRole:** USER, ADMIN
- **WorkspaceRole:** OWNER, ADMIN, EDITOR, VIEWER
- **WorkspaceSystemKind:** PERSONAL, SHARED_WITH_ME
- **NoteShareRole:** VIEWER, EDITOR
- **NoteShareStatus:** PENDING, ACCEPTED, DECLINED, REVOKED
- **NoteImageAssetStatus:** READY, DELETED
- **NoteImageOcrStatus:** PENDING, COMPLETE, FAILED
- **NoteLinkStatus:** PENDING, READY, FAILED
- **NoteDocumentOcrStatus:** PENDING, COMPLETE, FAILED
- **PushPlatform:** WEB, IOS, ANDROID
- **ShareAccessEntityType:** NOTE, WORKSPACE
- **ShareAccessPermission:** VIEWER, ADMIN, EDITOR

### Workspace

Lightweight tenant boundary. Fields: `id` (UUID PK), `name` (unique), `ownerUserId?`, `systemKind?`, `createdAt`, `updatedAt`, `deletedAt?`. Relations: documents, members, invites, share tokens, note media/links/docs, share placements/collaborators.

### User

Auth identity. Fields: `id`, `email` (unique), `name`, `passwordHash`, `role` (GlobalRole), `profileImage?`, `disabled`, `lastLogin?`, `createdAt`. Relations: memberships, preferences, device preferences, sharing, media, push, reminders, invites.

### UserRegistrationInviteToken

Admin-created registration invites. Fields: `id`, `email`, `createdByUserId`, `tokenHash` (unique), `expiresAt`, `usedAt?`, `createdAt`.

### PasswordResetToken

Fields: `id`, `userId`, `tokenHash` (unique), `expiresAt`, `usedAt?`, `createdAt`.

### UserDevicePreference

Per-user, per-device UI state (keyed by `deviceId` from localStorage). Fields include: `theme?`, `language?`, font scales, `editorToolbarMode`, `noteCardMaxHeightPx?`, banner title position, `activeWorkspaceId?`, `activeSharedFolder?`, checklist/card interaction toggles, `noteCardCompletedExpandedByNoteId` (JSON), `collapsedRichHeadingIds` (JSON). Unique on `[userId, deviceId]`.

### WorkspaceMember

Fields: `id`, `userId`, `workspaceId`, `role` (WorkspaceRole). Unique on `[userId, workspaceId]`.

### InviteToken

Workspace invite emails. Fields: `id`, `email`, `workspaceId`, `createdByUserId?`, `role`, `token` (unique), `expiresAt`, `used`, `createdAt`.

### ShareToken

Legacy doc share tokens. Fields: `id`, `docId`, `token` (unique), `expiresAt`, `role`.

### ShareAccessToken

Generic share links for notes/workspaces. Fields: `id`, `token` (unique), `entityType`, `entityId`, `sourceWorkspaceId?`, `createdByUserId`, `permission`, `expiresAt`, `revokedAt?`, timestamps.

### NoteShareInvitation

Collaboration invites. Fields: `id`, `docId`, `sourceWorkspaceId`, `sourceNoteId`, inviter/invitee user+email fields, `role`, `status`, `respondedAt?`, `revokedAt?`, timestamps.

### NoteCollaborator

Accepted collaborator row. Fields: `id`, `docId`, `sourceWorkspaceId`, `sourceNoteId`, `userId`, `invitationId?` (unique), `role`, `revokedAt?`, timestamps. Unique on `[docId, userId]`.

### NoteSharePlacement

Where a shared note appears in recipient's workspace. Fields: `id`, `userId`, `invitationId` (unique), `collaboratorId` (unique), `targetWorkspaceId`, `folderName?`, `collectionId?`, `labelIds` (JSON), `deletedAt?`, timestamps.

### Document

**Canonical Yjs persistence.** Fields: `id`, `workspaceId`, `docId` (unique — Yjs room name), `state` (Bytes), `stateVector` (Bytes), `createdAt`, `updatedAt`. Note: all note fields (title, type, etc.) are inside the Yjs blob.

### NoteImage

Uploaded image metadata + OCR. Fields: doc/workspace/note IDs, uploader, storage paths, dimensions, mime/size, `assetStatus`, `ocrStatus`, `ocrText?`, `ocrError?`, `sourceUrl?`, `fileName?`, soft-delete timestamps.

### NoteLink

URL preview metadata. Fields: doc/workspace/note IDs, URLs, hostname, title/description/content, image URLs (JSON), `sortOrder`, `status`, `errorMessage?`, soft-delete timestamps. Unique on `[docId, normalizedUrl]`.

### NoteDocument

File attachment metadata + OCR. Fields: doc/workspace/note IDs, uploader, storage paths, file name/extension, mime/size, page count, preview dimensions, OCR fields, soft-delete timestamps.

### NoteDocumentAnnotation

PDF/document annotations. Fields: `noteDocumentId`, `createdByUserId?`, `annotationType`, quote/body text, `pageNumber?`, `positionJson`, styling fields, soft-delete timestamps.

### UserPreference

Per-user server-side settings. Fields: `userId?` (unique), `theme?`, `language?`, `deleteAfterDays` (default 30), JSON maps for bubble colors, failed link dismissals, note colors, note banners.

### PushSubscription

Web Push / FCM tokens. Fields: `userId`, `deviceId`, `platform`, VAPID fields (`endpoint?`, `p256dh?`, `auth?`), `fcmToken?`, `enabled`, timestamps. Unique on `[userId, deviceId]`.

### PushNotificationLog

Delivery audit. Fields: `userId`, `type`, `title`, `body`, `data?`, `status`, `latencyMs?`, `error?`, `sentAt`.

### NoteReminder

Server-side reminder schedule (mirrors Yjs `reminderAt` for push delivery). Fields: `userId`, `deviceId`, `docId`, `noteId`, `workspaceId`, `reminderAt`, `noteTitle?`, `fired`, `firedAt?`, `notificationAcknowledgedAt?`, timestamps. Unique on `[userId, docId]`.

---

## 6. Key Files

| File | Purpose |
|------|---------|
| `src/main.tsx` | Frontend bootstrap: WS URL, DocumentManager, PWA init, theme/i18n providers |
| `src/App.tsx` | Main application shell (~10k lines): auth gate, routing, editors, modals, mobile UX |
| `src/core/DocumentManager.ts` | Central Yjs lifecycle: rooms, IDB persistence, WS providers, workspace switching |
| `src/core/noteModel.ts` | Yjs map helpers for note metadata (title, type, trash, collections, labels) |
| `src/core/richText.ts` | TipTap/Yjs rich text schema, collapsible headings, serialization |
| `src/components/NoteGrid/NoteGrid.tsx` | Masonry note grid, drag-drop layout, search integration |
| `src/components/NoteGrid/layout.ts` | Grid packing algorithm and height estimation |
| `src/components/Editors/NoteEditor.tsx` | Note type router (text, checklist, rich, drawing) |
| `src/components/Editors/RichTextEditor.tsx` | TipTap editor with collaboration extensions |
| `src/components/Editors/DrawingEditor.tsx` | Excalidraw + y-excalidraw integration (lazy-loaded) |
| `server.js` | Production server: static, REST, Yjs WS auth, persistence wiring, schedulers |
| `server/YjsPersistenceAdapter.js` | PostgreSQL + Redis persistence for Yjs rooms |
| `server/auth.js` / `server/authRouter.js` | JWT cookie sessions, login/register/reset |
| `server/workspaceRouter.js` | Workspace CRUD, membership, soft-delete |
| `server/noteShareRouter.js` | Note sharing, collaborators, placements, cross-workspace aliases |
| `server/noteMediaRouter.js` | Image/document upload, OCR triggers, link previews |
| `server/pushService.js` / `server/pushRouter.js` | Web Push, FCM, reminders, notification modes |
| `prisma/schema.prisma` | Database schema — source of truth for SQL models |
| `vite.config.ts` | Build config, PWA, dev Yjs embed, API proxy |
| `src/sw.js` | Service worker caching strategy |
| `docker-compose.yml` | Production stack definition (app + postgres + redis) |

---

## 7. Known Issues / Incomplete Areas

### Explicit UI placeholders

- **Documents media-dock tab** in `TextEditor` and `ChecklistEditor` renders `DocumentsPanel` with `showComingSoonPlaceholder` — copy says drawing attachments temporarily disabled (`src/core/i18n.tsx`: `documents.comingSoon*`).
- **Quick-create drawing** label: `createDrawingComingSoon` in i18n (drawing editor exists but quick-create path may still show placeholder in some menus).
- **Preferences `user` / `appearance` sections** in `PreferencesModal` fall through to generic "coming soon" placeholder — those sections are handled by separate modals (`UserModal`, `AppearanceModal`) opened from the main preferences list instead.

### Architectural / operational notes

- **`/readyz`** is documented in `server.js` header comment but implemented in `server/apiRouter.js` (only when PostgreSQL router is active).
- **`ws-server.js`** is a standalone relay on port 1234 — not part of normal Docker or `npm run dev` flow; kept for isolated WS testing.
- **OCR** requires Python + PaddleOCR. Bundled in Docker; may be absent or disabled locally (`OCR_DISABLED=1`).
- **Test coverage is minimal:** only `tests/phase9.test.js` exists.
- **`platforms/`** contains sample Android/iOS/browser-extension clipboard helpers — not wired into the main web build.
- **Prisma schema header** still references "Phase 11 auth" comments; auth **is implemented** (JWT cookies, users, RBAC) — comments are historical.
- **Local build artifact folders** like `dist-build-verify-notificationfix/` may exist locally; they are gitignored (`dist-*`) and not part of source.

### Active work in progress (current git status)

Uncommitted changes touch collapsible rich-text headings, device preferences API, push notifications, note grid drag/layout, `QuickReminderModal`, and related editor/card components.

---

## 8. Environment Variables

Do not commit real values. Sources: `.env.example`, `.env.docker.example`, `env.vite/.env.example`, and code references.

### Core runtime

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | Node environment |
| `PORT` | HTTP server port (default 27015 prod, 27016 dev server wrapper) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `APP_URL` | Public base URL for invite links, notification deep links, startup logs |
| `APP_PORT` | Docker host port mapping (compose) |

### Database / persistence

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string for Prisma |
| `DB_SCHEMA_SYNC` | Startup schema sync: `deploy`, `push`, or `none` |
| `DB_BASELINE_ON_NON_EMPTY` | One-time recovery for Prisma P3005 on non-empty DB |
| `REDIS_URL` | Redis connection string (optional) |
| `YPERSISTENCE` | Legacy LevelDB path for y-websocket |
| `PGTIMEZONE` | Display timezone for server-rendered timestamps |
| `LOG_PRISMA_QUERIES` | Enable Prisma query logging (`true`) |
| `PRISMA_FORCE_GENERATE` | Force `prisma generate` in postinstall script |

### Auth

| Variable | Purpose |
|----------|---------|
| `AUTH_JWT_SECRET` | JWT signing secret |
| `AUTH_COOKIE_NAME` | Session cookie name |
| `AUTH_COOKIE_SECURE` | Force Secure cookie flag |
| `AUTH_SESSION_DAYS` | Rolling session expiry in days |
| `AUTH_BCRYPT_ROUNDS` | bcrypt cost factor |
| `AUTH_ALLOW_REGISTER` | Allow open registration |

### SMTP / email

| Variable | Purpose |
|----------|---------|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Invite and email-mode notification delivery |

### Uploads / OCR

| Variable | Purpose |
|----------|---------|
| `UPLOAD_DIR` | Profile images and note media storage path |
| `OCR_DISABLED` | Disable OCR (`1`) |
| `OCR_LOG_OUTPUT` | Stream OCR child output to server logs |
| `OCR_PYTHON_BIN` | Python executable for OCR |
| `PADDLE_HOME` | PaddleOCR model cache directory |
| `PADDLE_PDX_MODEL_SOURCE` | Paddle model source (e.g. `BOS`) |

### Push notifications

| Variable | Purpose |
|----------|---------|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push (VAPID) |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | Firebase Cloud Messaging (iOS) |
| `WEB_NOTIFICATION_MODE`, `ANDROID_NOTIFICATION_MODE`, `IOS_NOTIFICATION_MODE` | Delivery mode per platform: `auto`, `push`, `email`, `off` |

### Housekeeping

| Variable | Purpose |
|----------|---------|
| `TRASH_CLEANUP_INTERVAL_MS` | Trash auto-delete scheduler interval |
| `WORKSPACE_CLEANUP_INTERVAL_MS` | Soft-deleted workspace purge interval |
| `WORKSPACE_CLEANUP_GRACE_MS` | Grace period before permanent workspace deletion |

### Docker Compose (postgres service)

| Variable | Purpose |
|----------|---------|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Bundled PostgreSQL credentials |

### Debug

| Variable | Purpose |
|----------|---------|
| `DEBUG_LOGGING` | Server-side structured debug log |
| `VITE_DEBUG_LOGGING` | Client debug log (batched to `/api/debug-log`) |

### Vite / frontend (build-time; `VITE_*` exposed to client)

| Variable | Purpose |
|----------|---------|
| `VITE_DEV_PORT` | Vite dev server port |
| `VITE_PREVIEW_PORT` | Vite preview port |
| `VITE_DEV_PUBLIC_ORIGIN` | Reverse-proxied dev origin for HMR |
| `VITE_DEV_STRICT_PORT` | Fail if dev port is taken |
| `VITE_API_PROXY_TARGET` | Backend URL for `/api` proxy in dev |
| `VITE_WS_URL` | Override Yjs WebSocket base URL |
| `VITE_YJS_EMBED` | Embed Yjs in Vite (non-dev modes) |
| `VITE_YJS_PROXY` | Proxy `/yjs` to backend (non-dev modes) |
| `VITE_VAPID_PUBLIC_KEY` | Optional baked-in VAPID public key |
| `VITE_NOTE_CARD_EFFECT` | `1` = HL2 electric-fence loading effect |

---

## 9. NPM Scripts

All scripts are in the root `package.json` (no workspace packages).

| Script | Description |
|--------|-------------|
| `dev` | Run backend + Vite dev server concurrently (`dev:server` + `dev:web`) |
| `dev:web` | Wait for backend, then start Vite dev server |
| `dev:server` | Run DB init CLI, then `server.js` with `--watch` |
| `predev:server` | Run `db:generate:if-needed` |
| `start` | Build frontend to `dist/`, then run `server.js` |
| `prestart` | Generate Prisma client + DB init |
| `start:server` | Run `server.js` without rebuilding frontend |
| `prestart:server` | Generate Prisma client + DB init |
| `build` | Production frontend build via `scripts/build-to-dist.cjs` |
| `preview` | Serve built app with `vite preview` |
| `ws` | Run standalone `ws-server.js` Yjs relay |
| `db:init` | Database creation + schema sync CLI |
| `db:generate` | `prisma generate` |
| `db:generate:if-needed` | Generate Prisma client only when schema changed |
| `db:migrate` | `prisma migrate dev` |
| `db:migrate:deploy` | `prisma migrate deploy` (production) |
| `db:migrate:status` | Check migration status |
| `db:push` | `prisma db push` |
| `postinstall` | Auto-run `db:generate:if-needed` |
| `test` | Run Node test runner on `tests/` |
| `release:patch` / `release:minor` / `release:major` | Bump version, commit, push tags |

---

## 10. What Not to Touch

Unless you fully understand the downstream effects:

### Core sync & state

- **`src/core/DocumentManager.ts`** — Every note, registry, collection, and label room flows through here. Workspace switch, IDB/WS lifecycle, and pending-sync semantics are easy to break.
- **`server/YjsPersistenceAdapter.js`** — Canonical persistence. Mistakes cause data loss or cross-workspace leakage.
- **`server.js` Yjs WebSocket handler** (~lines 1119+) — Auth, read-only enforcement, room namespacing, and foreign-workspace tab handling are security-critical.
- **`src/core/noteModel.ts`** — Yjs map shape is the contract for all note metadata across clients.

### Layout & rendering

- **`src/components/NoteGrid/layout.ts`** + **`useNoteGridDragManager.ts`** — Masonry packing and drag-drop are tightly coupled; small changes cause layout jumps or stuck placeholders.
- **`src/App.tsx`** — Monolithic orchestrator for auth, history/back stack, mobile gestures, and modal layering. High regression surface.

### Editors

- **`src/core/richText.ts`** — Large TipTap/Yjs schema; collapsible headings and internal origins are subtle.
- **`src/components/Editors/DrawingEditor.tsx`** + **y-excalidraw** — Lazy-loaded with error boundary; Excalidraw peer deps are fragile (`npm ci --legacy-peer-deps` in Docker).

### Auth & sharing

- **`server/auth.js`**, **`server/noteShareRouter.js`**, **`server/workspaceAccess.js`** — RBAC and cross-workspace share placement logic.
- **`server/workspaceMetadataEvents.js`** — Redis pub/sub contract for multi-tab workspace list freshness.

### Build & deploy

- **`vite.config.ts`** — PWA injectManifest, dev Yjs embed, and proxy rules. Breaking dev/prod parity causes "notes not syncing on mobile."
- **`scripts/build-to-dist.cjs`** — Custom dist output; `emptyOutDir: false` in Vite prevents SW build from wiping client assets.
- **`prisma/migrations/`** — Never edit applied migrations; add new ones via `db:migrate`.

### Caching

- **`src/sw.js`** — Incorrect cache rules can serve stale auth or block updates. Auth routes are explicitly excluded from API cache.

---

## Quick start for agents

```bash
# Install
npm ci --legacy-peer-deps

# Configure
cp .env.example .env
cp env.vite/.env.example env.vite/.env.development   # optional

# Dev (needs PostgreSQL reachable via DATABASE_URL)
npm run dev
# → Vite http://localhost:5173, API/WS backend http://localhost:27016

# Production-like
npm start
# → http://localhost:27015
```

Read `README.md` for Docker/Unraid deployment and Excalidraw library setup.
