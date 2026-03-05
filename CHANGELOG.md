# Changelog

All notable changes to this project are documented in this file.

## 1.0.62 - 2026-03-05

### Fixed
- Checklist outdent/un-indent now animates row movement (FLIP) to avoid the
  “teleport” feeling when items change indentation.
- Mobile checklist drag reliability: pointer capture keeps the pending drag
  gesture from being stolen by scroll/overscroll on first interaction.
- Checklist drag ghost now matches multi-line items more precisely by sizing
  the clone using the measured text element width (prevents re-wrapping).
- Checklist drag ghost styling is opaque with a solid background for clearer
  visibility while dragging.

### Changed
- Indenting a top-level checklist item that has children now preserves the
  max-1-level nesting rule by re-parenting its children to the new parent.
- Textarea auto-sizing is re-triggered on window resize so wrapped checklist
  rows don’t end up with stale heights after layout changes.

## 1.0.4 - 2026-03-01

### Added
- **Move to Trash (soft-delete)** — notes are now soft-deleted via a `trashed` /
  `trashedAt` flag stored inside the Yjs document metadata. Trashed notes are
  hidden from the main grid but remain persisted in PostgreSQL until the
  server-side cleanup process permanently removes them.
- `setNoteTrashed()` and `readTrashState()` helpers in `noteModel.ts` for
  toggling and reading trash state inside a Y.Doc.
- `DocumentManager.trashNote()`, `.restoreNote()`, `.isNoteTrashed()`, and
  `.permanentlyDeleteNote()` public API for trash lifecycle management.
- **Server-side trash cleanup scheduler** (`server/trashCleanup.js`) —
  periodically scans all persisted Yjs documents, identifies notes where
  `trashed === true` and `trashedAt` exceeds the user's `deleteAfterDays`
  retention preference, and permanently deletes them from PostgreSQL, Redis,
  and the notes registry CRDT.
- **User preferences backend** — new `UserPreference` Prisma model
  (`prisma/schema.prisma`) and REST API (`server/preferencesRouter.js`):
  - `GET /api/user/preferences` — returns preferences (upserts defaults).
  - `POST /api/user/preferences` — updates `deleteAfterDays` (1–365 range).
- `GET /api/trash` endpoint in `apiRouter.js` — lists all trashed notes with
  title, type, `trashedAt`, and size, sorted by most recently trashed.
- **Dev guards #6 and #7** (`devGuards.ts`) — warn in development when trashed
  notes leak into the visible grid or when `trashed=true` lacks a valid
  `trashedAt` timestamp.
- **Cross-tab trash reactivity** — `NoteGrid` now observes each loaded note's
  `metadata` Y.Map. When a remote tab trashes/restores a note, the metadata
  observer bumps a `metadataVersion` counter, `visibleIds` recomputes, and the
  note appears/disappears without a page refresh.
- **Mobile WebSocket resilience**:
  - `visibilitychange` + `focus` event handlers in `DocumentManager` —
    force-disconnect and reconnect all WebSocket providers when the tab returns
    to the foreground, recovering from silent connection death on mobile OS
    background suspension.
  - `online` event handler triggers the same reconnect cycle on network recovery.
  - `resyncInterval: 30_000` enabled on every `WebsocketProvider` — periodically
    re-sends Yjs Sync Step 1 to catch silently dropped frames on flaky networks.
  - `maxBackoffTime: 5_000` — caps reconnect exponential backoff at 5 seconds.
- **Server-side WebSocket ping/pong keep-alive** (`server.js`) — pings every
  client every 30 seconds; terminates connections that fail to respond, cleaning
  up dead mobile sockets before the 30-second y-websocket idle timeout.
- `npm test` script using Node.js built-in test runner (`node --test tests/`).
- 14 tests covering trash toggle, offline sync round-trip, CRDT convergence,
  cleanup expiry identification, preference validation, and metadata schema.

### Changed
- `App.tsx` — delete action now calls `manager.trashNote()` (soft-delete)
  instead of `manager.deleteNote()` (hard-delete).
- `trashedAt` stored as ISO-8601 string (e.g. `"2026-03-01T16:07:09.460Z"`)
  instead of epoch-ms number, for human readability and consistent formatting.
- `NoteGrid` drag and cross-tab-cancel logic now operates on `visibleIds`
  (filtered by trash state) instead of raw `orderedIds`.
- Server boot sequence extended: Step 3 starts trash cleanup scheduler;
  graceful shutdown stops the scheduler before flushing persistence.

## 1.0.6 - 2026-03-01

### Changed — Phase 10: Production Persistence Layer

- **Prisma model rename**: `YjsDocument` → `Document` (table: `document`).
  All server code (`YjsPersistenceAdapter`, `apiRouter`, `trashCleanup`) updated
  to use `prisma.document` accessor and simplified `{ docId }` where clauses.
- **`stateVector` now required** (`Bytes`, was `Bytes?`). Every persisted
  document stores both the full state and its state vector for efficient delta
  sync on client reconnect.
- **`docId` globally unique** (`@unique`, was compound `@@unique([workspaceId, docId])`).
  Simplifies lookups — a single `docId` maps to exactly one persisted document.
  Workspace index (`@@index([workspaceId])`) retained for scoped queries.
- **Formal migration system**: Initial migration created (`20260301234035_phase10_init`).
  Existing databases managed by `prisma db push` are baselined automatically.
  - Production (`NODE_ENV=production`): `prisma migrate deploy` on boot.
  - Development: `prisma db push` on boot (unchanged).
- **New npm scripts**: `db:migrate:deploy`, `db:migrate:status` for production
  migration workflows.
- **Dockerfile**: Runtime comment updated to document auto-migration on boot.
- **docker-compose.yml**: Comment updated (Phase 8 → generic).
- **README.md**: Added comprehensive setup docs:
  - Docker Compose quick start (managed Postgres)
  - Unraid / external database setup
  - Local development workflow
  - Database migration commands and workflow
- **server.js**: Header comments updated to Phase 10.
- **dbInit.js**: Dual-mode schema sync — automatically selects `prisma migrate deploy`
  (production) or `prisma db push` (development) based on `NODE_ENV`.

### Migration Notes
- **Existing databases**: If your database was created with `prisma db push`
  (pre-1.0.6), the old `yjs_document` table must be renamed to `document`
  before running the new migration. The easiest path is to drop and recreate
  the database (no data loss for Yjs docs — they are ephemeral and resync from
  connected clients). Alternatively, run:
  ```sql
  ALTER TABLE yjs_document RENAME TO document;
  ```
  Then baseline: `npx prisma migrate resolve --applied 20260301234035_phase10_init`

## 1.0.5 - 2026-03-01

### Changed
- Note cards now use fixed max heights by pointer type (desktop vs coarse/mobile);
  the max-height slider UI was removed.
- Note card previews no longer clamp text or truncate checklist previews.
- Note cards no longer show internal scrollbars when content exceeds max height;
  content clips instead.
- Checklist note cards keep the completed-items toggle visible by pinning it as
  a footer section even when the checklist body is clipped.
- Editors moved to a fixed-header + scrollable-body layout so mobile can scroll
  checklist items while keeping title/actions visible; text editor content now
  stretches to the bottom of the screen.

### Fixed
- Desktop checklist drag ghost sizing/visuals: width measurement is captured
  pre-drag and the ghost shadow stays dark across themes.
- Mobile checklist reordering now handles extreme variable-height items by using
  50% crossover semantics against neighbour midpoints (instead of closest-center),
  with hysteresis to prevent direction-flip jitter.

## 1.0.3 - 2026-03-01

### Added
- **Automatic database provisioning** — server now creates the PostgreSQL database
  on first boot if it does not exist (connects to the `postgres` admin DB, runs
  `CREATE DATABASE`). No manual `createdb` or pgAdmin step required.
- **Automatic schema sync on startup** — `prisma db push --skip-generate` runs on
  every boot to apply new tables/columns without data loss. Destructive changes are
  rejected and flagged for manual resolution.
- New `server/dbInit.js` module (database existence check + schema sync) and
  `server/dbInitCli.js` standalone CLI entry point.
- `npm run db:init` script for manual database provisioning.
- `npm run dev` now auto-provisions the database before starting Vite.
- **Configurable timezone (`PGTIMEZONE`)** — IANA timezone name (e.g.
  `America/Regina`) read from `.env`. PostgreSQL session timezone is set on boot;
  all REST API timestamps (Prisma `timestamptz` fields and Yjs epoch-ms metadata)
  are formatted in the configured timezone. Internal storage remains UTC.
- New `server/timezone.js` utility module using `Intl.DateTimeFormat` for
  zero-dependency timezone-aware ISO-8601 formatting.
- `GET /api/timezone` endpoint returns configured timezone and current server time
  in both UTC and local tz.
- All REST API responses (`/api/workspace`, `/api/docs`, `/api/docs/:docId`) now
  include a `timezone` field and format timestamps through the timezone formatter.
- `pg` (node-postgres) added as a production dependency for admin-level DB
  creation (Prisma cannot run `CREATE DATABASE`).

### Changed
- Server boot sequence restructured into an async `boot()` function that runs
  database provisioning → timezone SET → workspace init → listen, guaranteeing
  the backend is fully ready before accepting traffic.
- `Dockerfile` CMD simplified to `node server.js` — the server handles all
  migration/provisioning internally.
- `docker-compose.yml` updated with `PGTIMEZONE` env var documentation.

### Fixed
- **"Loading…" stuck on remote note creation** — NoteGrid doc-loading effect used
  a `cancelled` flag in its cleanup that raced with rapid Yjs observer re-fires.
  When the effect re-ran before the async doc load resolved, the cancelled closure
  discarded the result and `pendingDocLoadsRef` blocked retries. Removed the
  `cancelled` flag; dedup is now handled solely by `pendingDocLoadsRef` and the
  idempotent `setDocsById` functional updater.

## 1.0.2 - 2026-02-28

### Added
- Per-note pending sync status in the connection snapshot model (`pendingSyncNoteIds`) so UI can render sync state at the card level instead of a global icon.
- New connection status hook (`src/core/useConnectionStatus.ts`) using `useSyncExternalStore` for stable subscription semantics.
- Docker/compose deployment artifacts for simplified self-hosted setup:
  - `Dockerfile`
  - `.dockerignore`
  - `docker-compose.yml`
  - `DEPLOYMENT.md`

### Changed
- Connection indicator UX now shows only connection state globally (green/yellow/red) while pending sync is displayed per note card.
- Note cards now support a local pending-sync badge that appears only for notes edited while offline.
- Touch drag interaction in the note grid was reworked for mobile reliability:
  - Long-press touch activation for drag start.
  - Scroll-vs-drag intent arbitration so vertical page scroll wins when detected before drag activation.
  - Browser-level touch/pointer suppression only during active touch drag to prevent simultaneous native scroll + drag.
  - Reorder gating and FLIP stabilization around pickup to reduce mobile "bobbing" and startup jitter.

### Fixed
- False pending-sync state after refresh/startup by filtering non-user/internal registry writes from pending-sync tracking.
- React production runtime instability (`useSyncExternalStore` snapshot identity) by emitting stable snapshots and change-only notifications.
- Connection-state misclassification by distinguishing browser offline state from reconnecting state.
- Mobile drag jitter and mixed drag/scroll race conditions observed on Android browsers.
- Server/runtime configuration clarity:
  - `YPERSISTENCE` normalization and empty-value handling.
  - startup logging improvements for `HOST`/`APP_URL`/Yjs websocket URL reporting.

## 1.0.0 - 2026-02-27

### Added
- Offline-first note storage using Yjs + IndexedDB persistence (`y-indexeddb`).
- Real-time collaborative sync wiring with Yjs WebSocket providers (`y-websocket`).
- Registry-based note list and note order CRDT structures for stable list/order handling.
- Drag-and-drop note grid with swap-based ordering semantics and drag overlay support.
- Text and checklist note support backed by CRDT bindings for live updates.
- Service-worker/dev cache handling improvements for reliable local testing.

### Changed
- Refactored the UI into component-scoped modules (`NoteGrid`, `NoteCard`, `Editors`) with CSS modules.
- Moved styling to structured style layers (`variables.css`, `globals.css`, `layout.css`).
- Standardized note open/create/edit/delete flows around `DocumentManager` APIs.
- Improved drag behavior across columns and same-column moves with FLIP-based motion updates.

### Fixed
- Import/type squiggles from module resolution and CSS module typing gaps.
- Empty-body note open/delete flow so untitled/blank notes can still be selected and removed.
- Multiple stale/duplicate file conflicts from legacy root-level component files.
- Offline/online sync edge cases by ensuring provider/doc lifecycle cleanup and consistent room wiring.

## 1.0.1 - 2026-02-27

### Added
- Detailed inline maintenance comments across core app, grid, card, editor, and CRDT files.
- Explicit in-code guidance for where to adjust card width and responsive mobile/desktop behavior.
- Startup reflow-animation suppression comments and drag overlay sizing documentation.

### Changed
- Note grid responsive behavior refined for stability:
  - Desktop card width remains fixed while column count responds to available space.
  - Mobile portrait enforces 2 columns.
  - Mobile card width is computed from stable device short-side values and reused in portrait and landscape.
- Drag overlay width behavior stabilized on mobile to avoid ghost width jumps.
- Initial refresh behavior no longer animates cards back into place during hydration.

### Fixed
- Same-column drag swap visual artifacts from conflicting transform ownership.
- Resize and orientation edge cases causing inconsistent card widths on mobile.
- Mobile landscape scroll jitter that caused subtle card-width changes.
