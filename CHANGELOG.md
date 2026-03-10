# Changelog

All notable changes to this project are documented in this file.

## 1.0.9 - 2026-03-10

### Added
- **Shared With Me selection persistence.** Added per-device storage for the active Shared With Me folder so shared subtree selection survives reloads, restores, and workspace re-activation.
- **Earth & Neutral theme family.** Added a new curated theme category with sixteen earthy and neutral palettes, plus localized picker labels in English and Spanish.
- **Offline collaborator queue cache.** Added IndexedDB-backed collaborator snapshot and action-queue storage so collaborator changes can be staged offline and replayed once connectivity returns.

### Changed
- **Workspace and mobile shell UX.** Simplified the mobile header into a fixed single-row layout with a search overlay, made the workspace tree scrollable, surfaced the active workspace path in the sidebar, and added a sticky scope chip above the notes grid.
- **Share notification and collaborator flows.** Shared placement lookups now target the Shared With Me workspace explicitly, notification history can be cleared locally, collaborator rows show richer identity data, and collaborator role edits now sync through the same offline-safe pipeline.
- **Release documentation.** Added targeted functional comments across the new offline collaborator cache/replay and notification dismissal paths.

### Fixed
- **Dev authentication under Vite.** Login now waits for `/api/auth/me` to confirm a real session before entering the authenticated state, and local dev cookies no longer get marked `Secure` on plain HTTP.
- **Shared With Me disclosure correctness.** Shared folders stay visible even when Personal is active, and accepted placements restore the intended shared folder instead of collapsing back to the workspace root.
- **Mobile sidebar stability.** Opening the mobile drawer no longer shifts the notes grid mid-scroll because the page lock now uses overflow suppression instead of `position: fixed`.

## 1.0.80 - 2026-03-09

### Added
- **Note collaboration and recipient placement flows.** Added collaborator management, share notifications, Shared With Me placement handling, and accepted-shared-note alias mounting so users can receive notes into Shared With Me or Personal views.
- **Workspace and note share link tooling.** Added link-generation, copy/open, QR rendering, and client-side caching for workspace invites and public note share links, including public share route rendering.
- **Shared With Me system workspace support.** Added server helpers and note-share APIs to provision the system workspace, persist accepted placements, and expose collaborator/invitation state to the client.

### Changed
- **Workspace sidebar behavior.** Shared With Me now uses normalized display labels, nested folder disclosure, and root-vs-subfolder filtering so shared notes surface in the correct workspace branch.
- **Invitation and share UX.** Workspace invites can now be generated without SMTP delivery, collaboration modals follow the active theme, and share notifications present richer note/inviter context with explicit placement choices.
- **Release documentation.** Added branch-level and inline implementation comments across the new sharing, routing, caching, and collaboration flows introduced in this release.

### Fixed
- **Collaboration permissions.** Recipients now see self-removal instead of owner-style revoke controls, and self-removal no longer throws a forbidden error while still removing access successfully.
- **Live collaboration refresh.** Open collaborator and notification views now refresh when remote users accept, decline, revoke, or relocate shared notes.
- **Shared With Me placement correctness.** Shared With Me root no longer duplicates subfolder contents, and switching workspaces on desktop no longer collapses the Shared With Me disclosure list.

## 1.0.71 - 2026-03-09

### Added
- **Workspace deletion recovery plumbing.** Added live-workspace server helpers, cross-instance workspace metadata event handling, and client IndexedDB queue/snapshot support so deleted workspaces immediately roll users onto a valid fallback workspace.
- **Per-device quick-delete preference for checklist rows.** Added device-scoped persistence and preferences UI for always-visible checklist delete affordances on touch devices.

### Changed
- **Workspace switching offline model.** Workspace creation/deletion now uses a cache-first modal/sidebar flow with queued offline mutations that replay when connectivity returns.
- **Mobile editor keyboard handling.** Text and checklist editors now keep the software keyboard stable across row activation, drag handoff, quick-delete, and floating-toolbar presentation changes.
- **Rich-text behavior and spacing.** Full note editors now use tighter single-line Enter behavior, empty list items exit their list on a second Enter, and ProseMirror spacing selectors target the correct root node.
- **Release documentation.** Added branch-level and line-level implementation comments across the modified workspace, offline-sync, editor, and Vite proxy paths to document the new behavior.

### Fixed
- **Deleted workspace session repair.** Local and remote workspace deletions now clear stale active workspace state, refresh cookies/device preferences, and show a recovery notice instead of leaving the app pointed at a tombstoned workspace.
- **Mobile note editing regressions.** Fixed header scroll gesture loss, keyboard flicker during caret placement, and caret visibility near the keyboard for text notes and checklist rows.
- **Dev proxy resilience.** Vite proxy and embedded Yjs websocket handling now better tolerate backend restarts and socket resets without crashing the dev server.

## 1.0.70 - 2026-03-09

### Added
- **Rich-text editor foundation for notes and checklist rows.** Added TipTap/Yjs-backed rich-text helpers, shared editor components, and supporting toolbar/viewport preference hooks.
- **Mobile keyboard viewport helpers.** Added dedicated visual viewport hooks so editors can clamp to the visible viewport and keep floating controls aligned above the software keyboard.
- **Theme-aware app icon assets.** Added `darkicon1.png` and `lighticon1.png` for updated splash/icon usage.

### Changed
- **Text note creation flow.** New text notes now persist both plain text and structured rich-text content so draft and saved editors stay aligned.
- **Checklist editing UX on mobile.** Checklist rows now use richer inline editing, improved drag ghost rendering, faster drop settling, and keyboard-aware bottom chrome behavior.
- **Editor overlay navigation.** Mobile overlay history now guards against repeated back taps, and create/edit overlays are rendered mutually exclusively so they cannot stack.
- **Preferences and translations.** Updated preference UI styling/behavior and refreshed localized strings for the new editor capabilities.

### Fixed
- **Note editor render-time update warning.** Opening a text note no longer mutates Yjs content during render, removing the `Cannot update a component (NoteGrid) while rendering a different component (NoteEditor)` warning.
- **Mobile drag/close reliability.** Removed passive touch-path focus suppression that caused `preventDefault` warnings and hardened repeated editor open/close behavior.
- **Keyboard occlusion and scroll stability.** Mobile editors now better cover the keyboard transition area and avoid post-drag scroll-jump regressions.

## 1.0.67 - 2026-03-08

### Added
- **Firefox Android touch-drag polyfill for note cards.** Long-press drag now works on Firefox Android, including a bounded edge-scroll path and protection against pragmatic-drag-and-drop's broken-drag detection.
- **Expanded sidebar navigation model.** Added nested Reminders, Labels, Sorting, and Collections sections with animated disclosure transitions, desktop collapsed-sidebar auto-expand behavior, and improved mobile drawer interactions.
- **Desktop note-card footer dock.** Note cards now expose an editor-style bottom action dock on desktop hover, with anchored more-menu placement and active-card accent highlighting while the menu is open.

### Changed
- **Mobile sidebar polish.** Removed the collapsed shadow artifact, locked background interaction while the drawer is open, added swipe-to-close, increased item/icon sizing, and refined ordering/spacing.
- **Desktop sidebar readability.** Increased desktop sidebar type and disclosure icon sizing slightly and aligned nested disclosure arrows with the primary sidebar pattern.

### Fixed
- **Workspace logout WS spam.** Clearing the active workspace no longer reconnects the unscoped registry room and spam-retries websocket connections.
- **PWA auth/load startup robustness.** Registry initialization now respects the cached initial workspace ID earlier in boot, reducing reload-time races and splash failures.

## 1.0.66 - 2026-03-08

### Added
- **Device-scoped preferences persistence (Phase 12).** Theme, language, active workspace, and editor/card expansion state now persist via the `user_device_preference` table.
- **Workspace sidebar dropdown list.** The sidebar workspace section expands into a scrollable list (suitable for many workspaces) with a “Manage workspaces…” entry.
- **Workspace modal active-row emphasis.** Active workspace is pinned to the top, has an accent-highlighted name, and no longer shows an Activate button.
- **Share note action in the more-menu.** Creates a share link (`POST /api/docs/:docId/share`) and uses native share where available, otherwise falls back to clipboard or opening a new tab.

### Changed
- **Sidebar disclosure icon.** Sidebar expand/collapse arrows now use `/public/icons/Arrow.png` with theme-aware coloring.
- **Dev startup resilience on Windows.** `prisma generate` is best-effort so DLL locks don’t prevent `npm run dev`.

## 1.0.65 - 2026-03-08

### Added
- **Desktop more-menu as a real context menu (fine pointers).** Note/editor 3-dot
  menus now open a compact anchored popover on desktop instead of a full-screen
  sheet. Mobile/coarse pointers keep the bottom-sheet presentation.
- **Checklist empty-state “Add item”.** When all active checklist rows are
  completed (active list becomes empty), an “Add item” row appears and inserts a
  new checklist row. This works both when creating a new checklist and when
  editing an existing checklist note.
- **In-app splash overlay + layout animation gating.** After a refresh, the app
  keeps an overlay up until `NoteGrid` reports its initial data/layout pass is
  ready, preventing a “paint then immediately animate” flash.
- **Dev boot ordering helper.** Added a small `/healthz` polling helper so Vite
  doesn’t start proxying before the backend is ready.

### Changed
- **Notes grid canonical ordering: reading order (row-major).** The Yjs-stored
  order now represents left-to-right, top-to-bottom reading order. Each device
  reconstructs its local columns via round-robin dealing so different column
  counts still preserve the same visual sequence.
- **Drag insertion-point stability.** Column detection uses the raw pointer X
  (more responsive for cross-column moves) and row detection uses the ghost card
  edges (matches visible overlap). The post-insertion cooldown was increased to
  better avoid oscillation during spring animation.

### Fixed
- **Translation freshness after deploy.** Service worker now bypasses caching for
  `/locales/` JSON so updated translations take effect immediately.

## 1.0.64 - 2026-03-06

### Changed
- **Notes grid drag-and-drop: complete rewrite from swap-based to insertion-based
  model.**  Cards now slide apart to show where the dragged card will land (via
  framer-motion `layout` animations) instead of swapping positions on hover.
  - Replaced the swap-based drag model with an insertion + placeholder approach:
    the dragged card's grid slot stays as an invisible placeholder to hold space,
    while a ghost overlay follows the pointer.  Neighboring cards animate into
    their new positions before the drop.
  - Switched from custom FLIP animation code to framer-motion's `layout` prop
    and `LayoutGroup` for automatic layout-change animations with spring physics.
  - Added `framer-motion` as a dependency.
- **Drag hit detection: nearest-edge vertical detection.**  The ghost card's top
  edge is used when dragging up, and its bottom edge when dragging down, to
  determine insertion position.  This solves the problem where dragging a tall
  card above a short card required moving impossibly far off-screen.  A 16 px
  dead zone around each card's midpoint prevents oscillation.
- **Post-insertion cooldown (150 ms).**  After each insertion-point change, rect
  recalculation is paused briefly so framer-motion's spring animation settles and
  intermediate `getBoundingClientRect()` values don't cause oscillation.
- **Post-drop column preservation (sticky columns).**  After a drop, the column
  layout is preserved across re-renders instead of being re-packed by height.
  Only cards causing egregious height imbalance (>2x tallest-to-shortest ratio)
  are moved—from the bottom of the tallest column to the shortest—rather than
  shuffling all columns.
- **Cross-device layout sync.**  Column slot lengths (the number of cards per
  column) are now stored in a Yjs `noteLayout` map alongside the flat note order.
  Other devices reconstruct the same column grouping via slot-based splitting
  instead of height-based greedy packing, which diverged because card heights
  differ across viewports.  The flat order is now column-major so slot-boundary
  slicing reproduces the original grouping.
- **Scrollbar stability.**  Added `scrollbar-gutter: stable` on `<html>` and
  `overflow-x: clip` on `<html>`/`<body>` to prevent layout shift during
  drag-induced column repacks.

### Technical Details
- New files: `layout.ts` (column utilities, insertion-point detection),
  `useNoteGridDragManager.ts` (drag manager hook), `flip.ts` (height
  measurement), `autoScroll.ts` (legacy, unused).
- Modified: `NoteGrid.tsx` (framer-motion grid, sticky columns, Yjs layout map),
  `NoteGrid.module.css` (placeholder + ghost styles), `DocumentManager.ts`
  (`getNoteLayout()` for Yjs layout map), `globals.css` (scrollbar stability).

## 1.0.63 - 2026-03-05

### Fixed
- Mobile editor open-flow hardening: prevented touch/click compatibility event
  pass-through when opening note editors (especially checklist rows on Android
  Firefox/Chrome) by combining pointer capture, post-open interaction guards,
  and early focus suppression during the guard window.
- Mobile landscape behavior: editor media dock interactions now stay locked
  closed in landscape, and app header morph transitions are disabled while
  landscape is active.
- Vite dev websocket reliability/noise: development mode now embeds the Yjs
  websocket handler by default, preventing `/yjs` proxy socket errors such as
  `ECONNABORTED` / `ECONNREFUSED` spam during iterative dev runs.

### Changed
- Editor title styling (all text/checklist editors, mobile + desktop):
  removed shaded title background and increased title emphasis (larger + bold).
- Editor dock and formatting labels were aligned across locale dictionaries and
  i18n fallback messages to keep UI strings consistent in all language/loading
  branches.
- Added detailed implementation comments across modified code paths to document
  branch-specific behavior and interaction guards for future maintenance.

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
