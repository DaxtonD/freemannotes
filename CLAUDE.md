# Freeman Notes — Agent Reference

**Self-hosted, offline-first, real-time collaborative PWA.** React 19 + TypeScript + Vite 7, Node.js backend, Yjs CRDT, PostgreSQL/Prisma, Redis (optional).

**Principle:** Offline-first is non-negotiable. Every change must preserve IDB persistence, Yjs sync, PWA state, and note grid stability. Decision rule: does it improve speed / offline / sync / simplicity?

> Read **`memory/`** files before implementing. Institutional gotchas live there. Read **`PROJECT_PHILOSOPHY.md`** for the full decision framework.

---

## Stack

**Frontend:** react ^19.2.4 · vite ^7.3.1 · typescript ^5.9.3 · framer-motion ^12.35.2 · @tiptap/react ^3.20.1 · @excalidraw/excalidraw ^0.18.1 · @tanstack/react-virtual ^3.13.24 · @atlaskit/pragmatic-drag-and-drop ^1.7.9 · @hello-pangea/dnd ^18.0.1 · yjs ^13.6.29 · y-websocket 2.1.0 · y-indexeddb ^9.0.12 · y-excalidraw ^2.0.12 · y-prosemirror ^1.3.7 · vite-plugin-pwa ^1.2.0 · markdown-it ^14.1.1 · mammoth ^1.12.0 · xlsx ^0.18.5

**Backend:** Node 20-bookworm-slim · @prisma/client ^5.22.0 · ioredis ^5.10.0 · ws ^8.19.0 · sharp ^0.34.5 · jsonwebtoken ^9.0.3 · web-push ^3.6.7 · busboy ^1.6.0

**DB:** PostgreSQL 16-alpine · Redis 7-alpine (optional)

**External runtime:** PaddleOCR via Python 3 in Docker (`server/ocrRunner.py`). Disable locally: `OCR_DISABLED=1`.

---

## Architecture

```
Browser (React SPA)
  ├─ IndexedDB (y-indexeddb)     offline Y.Doc cache
  ├─ Service Worker (src/sw.js)  precache, API cache, background sync
  ├─ REST /api/*                 cookie JWT auth
  └─ WS /yjs/<room>             Yjs CRDT sync
        ▼
server.js (HTTP, default port 27015)
  ├─ static ./dist
  ├─ REST routers  server/*.js
  ├─ WS /yjs/*    role-gated Yjs rooms
  ├─ WS /ws/metadata  workspace fan-out to connected tabs
  └─ YjsPersistenceAdapter → PostgreSQL (+ Redis cache)
```

**Ports:** Production=27015 · Dev backend=27016 · Vite dev=5173 · Vite preview=4173

**Dev:** `npm run dev` runs backend (27016) + Vite (5173) concurrently. Vite proxies `/api`, `/uploads`, `/ws` to `http://localhost:27016`. Vite **always embeds** a Yjs WS server on `/yjs/*` during dev (`yjsWebsocketPlugin` in `vite.config.ts`).

**Yjs rooms:** `<workspaceId>:<noteId>` · `<workspaceId>:__notes_registry__` · `__collections_registry__` · `__labels_registry__`

**Note metadata** (title, type, trash, etc.) lives **inside the Yjs doc** (`src/core/noteModel.ts`), not SQL columns. Yjs blobs: `Document.state` (BYTEA). Auto-save debounced 5s; full write on last disconnect.

**Auth:** HTTP-only JWT cookie (`freemannotes_session`, includes `userId` + `workspaceId`). Set `Secure` only when `x-forwarded-proto=https`, `req.socket.encrypted`, or `AUTH_COOKIE_SECURE=true`. Never base on `NODE_ENV`. Sessions rolling on `/api/auth/me`. SW must never cache auth or `Cache-Control: no-store` responses.

**Redis:** Yjs doc cache (24h TTL) in `server/YjsPersistenceAdapter.js` · workspace pub/sub channel `freemannotes:workspace:metadata` in `server/workspaceMetadataEvents.js` · reminder fan-out in `server/pushService.js`.

**Service Worker:** Source `src/sw.js`, built via `vite-plugin-pwa` `injectManifest`. Registered via `src/core/pwa.ts` `initPwa()`. Cache-first: app shell, static assets, GET `/api/*` (except `/api/auth/*` and `no-store`). PWA dev mode disabled.

---

## Key Files

| File | Role |
|---|---|
| `src/main.tsx` | Bootstrap: WS URL, DocumentManager, PWA, theme/i18n |
| `src/App.tsx` | ~10k lines: auth gate, routing, editors, modals, mobile UX |
| `src/core/DocumentManager.ts` | Yjs room lifecycle, IDB persistence, WS providers, workspace switching |
| `src/core/noteModel.ts` | Yjs map helpers for note metadata |
| `src/core/richText.ts` | TipTap/Yjs schema, collapsible headings, serialization |
| `src/components/NoteGrid/NoteGrid.tsx` | Masonry grid, drag-drop, search |
| `src/components/NoteGrid/layout.ts` | Grid packing algorithm, height estimation |
| `src/components/Editors/NoteEditor.tsx` | Note type router (text/checklist/rich/drawing) |
| `src/components/Editors/RichTextEditor.tsx` | TipTap + collaboration extensions |
| `src/components/Editors/DrawingEditor.tsx` | Excalidraw + y-excalidraw (lazy-loaded) |
| `server.js` | Production server: static, REST, Yjs WS auth, schedulers |
| `server/YjsPersistenceAdapter.js` | PostgreSQL + Redis Yjs persistence |
| `server/auth.js` / `server/authRouter.js` | JWT cookie sessions |
| `server/noteShareRouter.js` | Sharing, collaborators, cross-workspace aliases |
| `server/noteMediaRouter.js` | Image/doc upload, OCR, link previews |
| `server/pushService.js` / `server/pushRouter.js` | Web Push, FCM, reminders |
| `prisma/schema.prisma` | DB schema source of truth |
| `vite.config.ts` | Build, PWA, dev Yjs embed, proxy |
| `src/sw.js` | Service worker caching strategy |

---

## Data Models (SQL)

**Key tables:**
- `Document` — `docId` (unique Yjs room name), `state` (BYTEA), `stateVector` (BYTEA)
- `UserDevicePreference` — unique `[userId, deviceId]`; includes `collapsed_rich_heading_ids`, `active_workspace_id`, `active_shared_folder`, `note_card_max_height_px`, `note_card_click_opens`, `auto_scroll_to_bottom_on_open`
- `UserPreference` — `note_colors_by_note_id` (JSON), `note_banners` (JSON), `notePinsByDocId` (JSON), `deleteAfterDays` (default 30)
- `NoteReminder` — unique `[userId, docId]`; `deviceId`-targeted push delivery
- `NoteImage` / `NoteLink` / `NoteDocument` — media metadata + OCR; all soft-deletable
- `NoteCollaborator` — unique `[docId, userId]`
- `NoteSharePlacement` — where shared note appears in recipient's workspace
- `WorkspaceMember` — unique `[userId, workspaceId]`; roles: OWNER, ADMIN, EDITOR, VIEWER

**Enums:** GlobalRole (USER, ADMIN) · WorkspaceRole (OWNER, ADMIN, EDITOR, VIEWER) · NoteShareStatus (PENDING, ACCEPTED, DECLINED, REVOKED) · NoteImageAssetStatus (READY, DELETED) · PushPlatform (WEB, IOS, ANDROID)

**Prisma gotchas:**
- Windows: `prisma generate` can EPERM on DLL if Node is running — stop all processes first. Missing delegate = stale client → regenerate.
- Raw SQL migrations must use mapped table names (`user_device_preference` not `UserDevicePreference`) — wrong name → Postgres `42P01` + blocked future migrations.
- Never edit applied migrations — add new ones. Keep `prisma` in production deps (Docker prune needs it).
- `DB_SCHEMA_SYNC`: `deploy` (prod), `push` (dev/reset), `none`.

---

## Environment Variables

| Variable | Value / Purpose |
|---|---|
| `PORT` | 27015 prod, 27016 dev wrapper |
| `APP_URL` | Public base URL (invite links, deep links) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis (optional) |
| `AUTH_JWT_SECRET` | JWT signing secret |
| `AUTH_COOKIE_NAME` | Default: `freemannotes_session` |
| `AUTH_COOKIE_SECURE` | `true`/`1` force secure; `false`/`0` force insecure |
| `AUTH_SESSION_DAYS` | Rolling session expiry (defaults to non-expiring) |
| `AUTH_ALLOW_REGISTER` | Open registration |
| `UPLOAD_DIR` | Media storage path |
| `OCR_DISABLED` | `1` to disable OCR |
| `OCR_PYTHON_BIN` | Python executable for OCR |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | iOS FCM |
| `WEB_NOTIFICATION_MODE` / `IOS_NOTIFICATION_MODE` / `ANDROID_NOTIFICATION_MODE` | `auto`/`push`/`email`/`off` |
| `TRASH_CLEANUP_INTERVAL_MS` / `WORKSPACE_CLEANUP_INTERVAL_MS` | Schedulers |
| `VITE_DEV_PORT` | Default 5173 |
| `VITE_API_PROXY_TARGET` | Default `http://localhost:27016` |
| `VITE_WS_URL` | Override Yjs WS base URL |
| `VITE_DEV_PUBLIC_ORIGIN` | Reverse-proxied dev origin for HMR |
| `DEBUG_LOGGING` / `VITE_DEBUG_LOGGING` | Server / client debug logs |
| `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | Email delivery |

---

## NPM Scripts

`npm run dev` — backend (27016) + Vite (5173) concurrently  
`npm start` — build frontend → run server (27015)  
`npm run build` — production build via `scripts/build-to-dist.cjs` (builds to temp, verifies, publishes to `dist/`)  
`npm run db:init` / `db:generate` / `db:migrate` / `db:migrate:deploy` / `db:push`  
`npm test` — `tests/phase9.test.js` (minimal coverage today)  
`npm run release:patch/minor/major` — version bump + tag

Install: `npm ci --legacy-peer-deps` (required for Excalidraw peer deps).

---

## Do Not Touch (without deep understanding)

- **`src/core/DocumentManager.ts`** — workspace switch, IDB/WS lifecycle, pending-sync semantics
- **`server/YjsPersistenceAdapter.js`** — data loss / cross-workspace leakage if broken
- **`server.js` Yjs WS handler (~line 1119+)** — auth, VIEWER read-only, room namespacing (security-critical)
- **`src/core/noteModel.ts`** — Yjs map shape is the wire contract across all clients
- **`src/components/NoteGrid/layout.ts`** + **`useNoteGridDragManager.ts`** — masonry + drag tightly coupled
- **`src/App.tsx`** — hooks must stay above auth early-returns; monolithic, high regression surface
- **`src/core/richText.ts`** — TipTap/Yjs schema + collapsible headings; subtle invariants
- **`vite.config.ts`** — PWA injectManifest, dev Yjs embed, proxy rules
- **`scripts/build-to-dist.cjs`** — `emptyOutDir: false` in Vite prevents SW build wiping assets
- **`prisma/migrations/`** — never edit applied migrations
- **`src/sw.js`** — auth routes excluded from cache; stale cache rules break auth or updates

---

## Critical Gotchas

### App.tsx Hook Order
Never add React hooks after auth early-returns (`if (authStatus === 'unauth') return ...`). Hook count changes → React error #310 (blank UI). All `useCallback`/`useMemo`/`useEffect` must be above those returns.

### NoteGrid Column Invariant
`flattenColumns(columns) === renderedIds` must hold or stickyColumns is rejected and falls back to repack. Use `splitIntoColumnsBySlotLengths` (satisfies invariant). Do NOT use `splitIntoColumnsByHeight` (fails with non-uniform heights). `startupLayoutAnimationsReady` must default `false` — workspace-switch effect does not fire on mount. Do NOT include `noteHeightsVersion` in editor-close restore gate deps.

### Drag Insertion
- **Cross-column:** anchor = raw pointer (`pointer.clientX/Y`). Do NOT use ghost edges/center.
- **Same-column:** ghost leading edge vs card midpoint.
- Cooldown: 280ms after insertion-point change (framer-motion spring displaces DOMRects during window).
- Touch drag cooldown: 48ms (shorter than pointer).
- Pin groups: pinned and unpinned notes are separate reorder groups. `findInsertionPoint` skips opposite-pin cards.

### Pinning
Pin state is user-scoped: `notePinPreferences.ts` / `UserPreference.notePinsByDocId`. Never write to shared Yjs `metadata.isPinned` (cleared on toggle, not used for display). Canonical Yjs `noteOrder` is never pin-sorted; display sort is applied at render time.

### Note Colors & Banners
- Note colors: `user_preference.note_colors_by_note_id`. Do NOT write to shared Yjs metadata.
- Adding `NoteColorToken`: update BOTH `src/core/noteColors.ts` AND `server/preferencesRouter.js` `VALID_NOTE_COLOR_TOKENS` or color flash-reverts on round-trip.
- Banners: shared Yjs `metadata.bannerFile`. Warm cache: `src/core/noteBannerWarmCache.ts` (`fn_banner_warm_v1` localStorage, `noteId → bannerFile|null`).
- Banner assets: `public/CardBanners/Dark` + `public/CardBanners/Light`. Server discovers from `dist/CardBanners/` at runtime (not `public/`).
- `readSynchronousWarmStartupBannerUrls` early-exit: `if (Object.keys(noteBannerPrefs).length === 0) return []`. Do NOT gate on warm cache — warm cache persists across sessions and would block `createRoot()` ~900ms on every warm start.

### i18n
Add all new UI copy to `src/locales/en.json`, `src/locales/es.json`, AND `FALLBACK_MESSAGES` in `src/core/i18n.tsx`. No hardcoded user-facing strings. `public/locales/` = legacy copies, not runtime — do not update.

### Workspace Metadata Real-Time
- WS path `/ws/metadata` (authenticated, separate from `/yjs`).
- Redis pub/sub: `freemannotes:workspace:metadata`. Publish after workspace create/delete/rename + reminder state changes.
- Disable Yjs WS sync before `manager.setActiveWorkspaceId(...)` during bootstrap to prevent `close forbidden namespace` spam.
- Seed `freemannotes.workspace.selection.cache.v1` during normal auth/login flows (not only on explicit workspace switch — Safari mid-preload can land on wrong workspace).

### Stale IDB / Workspace 403
Before reconnect activation loop: intersect `manager.discoverLocalWorkspaceIds()` with `readCachedWorkspaceSnapshot(userId, deviceId).workspaces`. On 403/404: call `removeCachedWorkspace(...)` and clear stale selection fallback.

### Note Move / docId Caches
Moving a note changes docId: `${sourceWorkspaceId}:${noteId}` → `${targetWorkspaceId}:${noteId}`. Must migrate: Yjs persistence, note media, note documents, collaborator snapshots, reminder caches, note-order snapshot, labels/collections (merge by name/path). Do not treat transient empty server responses as authoritative during move.

### Mobile History Stack (Android PWA)
`isMobileDismissLayerHistoryState()` recognizes: `__moreMenu`, `__reminderModal`, `__quickReminderModal`, `__noteCollectionModal`, `__noteLabelsModal`, `__collectionManagementModal`, `__noteColorPicker`, `__noteBannerPicker`, `__chipOverlay=collaborator|attachments`. On popstate landing on these: reset exit-back count, return early. Do NOT call `applyOverlaySnapshot(EMPTY)` — grid is still at base.

`closeForChildOverlay` (more-menu) skips `history.back()` when opening nested modals, leaving an orphaned `{__moreMenu}` entry. All modals opened via `closeForChildOverlay` (`NoteBannerPickerModal`, `NoteColorPickerModal`, `NoteLabelsModal`, `NoteCollectionModal`, `ReminderModal`) use `replaceState` instead of `pushState` when the current history state is `{__moreMenu:true}` — same as the image upload modal — so the orphan is consumed and back-button press count stays at 1. App popstate ignores `__noteImageUpload` entries.

`NoteBannerPickerModal` pushes/replaces `{__noteBannerPicker:true}` on coarse-pointer and calls `history.back()` on cleanup — same pattern as `NoteColorPickerModal`.

### Scroll Lock
Use `useBodyScrollLock` from `src/core/useBodyScrollLock`. Mobile FAB (`isFabOpen`) must NOT use body scroll lock — iOS scroll lives on `.test-harness-root`. Document viewer with pinch: `disableTouchAction=false`. Desktop editor open: `useBodyScrollLock(isEditorOverlayOpen)` + `pointer-events: none` on `.editor-open .app-shell`.

Do NOT apply `overflow:hidden` to `.app-main`, `.app-shell`, `.test-harness-root`, or `.app-sidebar` via body-scroll-locked CSS — those are not scroll containers on mobile and gaining `overflow:hidden` snaps the grid to y=0 and breaks `position:sticky` on `.app-main-sticky`. The `html/body { overflow:hidden }` inline styles set by `useBodyScrollLock` plus `touch-action:none` on `html/body` are sufficient. See `globals.css` `@media (pointer:coarse)` scroll-lock comment.

**On mobile (`pointer:coarse`), `useBodyScrollLock` does NOT set `overflow:hidden` on html/body** — it only sets `touch-action:none` (non-allow-touch) and adds the `body-scroll-locked` CSS class (which applies `overscroll-behavior:none`). `overflow:hidden` on the scroll root resets the visual scroll to y=0 on Android Chrome, making `backdrop-filter:blur()` overlays show the wrong part of the grid and causing `.app-main-sticky` to lose its sticky scroll context. On desktop (`pointer:fine`), `overflow:hidden` IS applied (via `@media (pointer:fine)` CSS rule) to prevent keyboard/wheel scroll of the background. `NoteCardMoreMenu` follows the same rule: mobile uses only `touch-action:none`, not `overflow:hidden`.

### Collapsible Rich Headings
- `heading.attrs.collapsible` + `collapseId` live on Yjs (shared, all devices). Collapsed/expanded state: device-local in `user_device_preference.collapsed_rich_heading_ids` + localStorage `freemannotes.collapsibleHeadingPrefs.v1:${userId}::${deviceId}`. Never sync via Yjs.
- Section boundary stops only at **collapsible** headings with `level <= owner` (`isCollapsibleHeadingSectionBoundary` in `collapsibleRichHeadings.ts`).
- Animation: in-flow opacity fades only (no spacers, no absolute positioning). `applyCollapsedState` must run BEFORE adding animation guard.
- Per-note pref subscription (not global) to prevent render storm on collapse toggle (~192 NoteCard renders otherwise).

### TipTap / Editors
- TipTap v3 StarterKit includes link, underline, undoRedo — disable when using Collaboration: `link: false, underline: false, undoRedo: false`.
- y-excalidraw 2.0.12 crashes in non-English locales with `undoConfig` — instantiate `ExcalidrawBinding` without it; wire `Y.UndoManager` to `[data-testid="button-undo"]` / `[data-testid="button-redo"]`.
- Excalidraw `DrawingEditor.tsx` `syncViewportOffsets` effect must NOT guard on `!usesMobileEditorLayout` — runs on all device types.
- Drawing canvas background: `metadata.drawingBackgroundColor` (separate from note color which is user-scoped).
- `DrawingEditor.tsx` `initialData.appState`: `currentItemFontFamily: FONT_FAMILY.Nunito`, `currentItemRoughness: 0`, `currentItemStrokeWidth: 1`, `currentItemRoundness: 'sharp'`.

### Checklist Editors
- Mobile keyboard detection: `window.innerHeight - (visualViewport.offsetTop + visualViewport.height)` (actual occlusion), NOT `innerHeight - visualViewport.height`.
- `quickDeleteChecklist` is per-device pref — disable on fine-pointer devices.
- Pending-new save affordance: check `canSavePendingNew` against queued images + links + drawing IDs, not only Yjs `isModified`.
- `selectedNoteIsPendingNew` useMemo must live before App auth early-returns (hook order).

### Image Upload (NoteImageUploadModal)
- Show confirmation BEFORE `await queueNoteImagesForUpload` — `scheduleQueuedNoteImageFlush` inside it can be slow/fail; confirmation appears immediately after validation passes.
- Modal stays open after submit — do not call `props.onClose()` in submit handler.
- `NoteMediaPanel` `scrollIntoView` on new image tile: suppress for 500ms on mount and docId changes (`skipQueuedScrollUntilRef`).
- `queueNoteImagesForUpload` emits `note-media-changed` and increments `queuedCountByDocId` synchronously for chip rail.

### Note Card Media
- Empty text/checklist cards with only images/drawings: show media preview grid (`computeMediaPreviewSlots(drawingCount, imageCount)` caps drawings at 2, total at 4).
- `useLinkedDrawingThumbnail` called unconditionally twice (index 0, index 1) so hook count is stable.
- Drag ghost: capture markup synchronously in `beginManagedDrag`; retain blob URLs via `noteCardDragMediaRetention.ts` until drop-settle.
- Offline images: preserve local previews on 403; do NOT wipe IDB previews on 403.

### NoteGrid Startup Race
- Cold start: `allDocsLoaded` debounced until visible set stable. Warm boot: snapshot authoritative until live doc has canonical metadata (type/createdAt/updatedAt/trashed/archived/collectionId/labelIds/reminderAt/isPinned/lastAccessedAt).
- `WorkspaceChangedError` from DocumentManager during hydration → catch and retry.
- Workspace changes rearm cold-start gates. View-mode changes (card/list/strip) must NOT rearm.
- `cardPositionAnimationsReady = Boolean(activeDragId) || (layoutReady && startupLayoutAnimationsReady)` — `activeDragId` bypasses cold-start gate for immediate drag response.

### Reminder Notifications
- Targeted to `note_reminder.deviceId`, not all push subscriptions.
- Trashed notes must not fire reminders — `server/pushService.js` checks `trashed: true` in persisted Yjs metadata.
- Reminder clear/update: reconcile both `freemannotes.reminderStates.v1.<userId>` and `freemannotes.pendingReminderSync.v1:<userId>:<deviceId>`.

### CollaboratorModal
- `showManageSections = snapshot.canManage || !accessResolved` — mount accordion headers immediately, don't wait for canManage.
- Load cached note share links in `useLayoutEffect` on open.
- No "syncing" status label — causes layout shift.

### BubbleView
- **`notesStable` flag**: Controls whether `stableFilteredNotes` updates and whether layout transitions enable. Set `false` at the **top of the `useEffect` body** (dep changes only — NOT inside `refresh()` — otherwise 5 s periodic score-refreshes would momentarily disable transitions and snap bubbles). Set `true` after `await Promise.all(otherWorkspaces.map(...))` in `refresh()`, i.e. after all workspaces have loaded.
- **`layoutChangeKey`**: `${containerWidth}:${Math.round(effectiveZoom)}` — changes on zoom-slider drag or window resize → disable `useLayoutEffect` fires → bubbles snap immediately. Score-driven changes do NOT alter this key → slow organic transitions stay active.
- **`stableFilteredNotes` / size-class gate**: `packedLayout` deps use `stableFilteredNotes` (updated only when `notesStable=true` AND `scoreToSizeClass(score)` changed for at least one note). Minor EMA fluctuations within the same class do NOT trigger a repack. NEVER replace `stableFilteredNotes` with raw `filteredNotes` in `packedLayout` deps — that causes N streaming repacks during load (one per inactive workspace).
- **`cloudRef` / `hasMeasuredCloud`**: Only set `hasMeasuredCloud=true` from the ResizeObserver callback (`fromObserver=true`). The synchronous pre-warm `measure(false)` call must NOT set it — the browser hasn't finalised layout yet and the width can differ, causing bubbles to snap on first appearance after a view switch.
- **Observer rules**: Content and checklist Yjs observers are intentionally NOT set up in `useBubbleNotes` — they fire on every keystroke and don't affect scoring. Only `meta.observe` and `titleText.observe` are wired. The 5 s debounce on `scheduleRefresh` is intentional (score buckets have ≥5-min minimum granularity).
- **CSS overflow on `.cloud`**: Do NOT add `overflow-x: hidden` or `overflow-y: hidden/visible` back. The CSS spec computes `overflow-x: hidden; overflow-y: visible` as `overflow-y: auto`, creating a scroll container that clips transitioning bubbles and shows spurious scrollbars on resize or zoom.
- **CSS transitions**: `.cloudItem` uses deliberately slow transitions (2 500 ms size, 4 000 ms position) so score-driven drift is imperceptible. Do not shorten — fast transitions during collaborative editing look like constant jitter.

### BubbleView / Shared Notes
- Shared With Me notes: alias placements from `/api/note-shares/placements`, IDs like `shared-placement:<placementId>`.
- Refresh placements + update DocumentManager external room aliases before opening a shared bubble.

### iOS Safari / Android PWA
- iOS: viewport `width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`. Also `-webkit-text-size-adjust: 100%` in globals.css.
- Android standalone: detect via display-mode `standalone`/`fullscreen`/`minimal-ui` + `android-app://` referrer. Apply zoom prevention before React boots via `index.html` meta mutation.

### Build Gotchas
- `framer-motion` must be ^12.35.2 (12.35.0 had broken motion-dom).
- Docker `npm prune --omit=dev` must use `--legacy-peer-deps --ignore-scripts` (y-excalidraw peer conflict).
- Vite outDir cleanup can EPERM on locked `dist/assets` on Windows — `build-to-dist.cjs` handles with retry+copy.
- Keep TypeScript `noEmit: true` — tsc writing to `dist/` breaks server static serving.
- Vite can EPERM renaming `sw.mjs → sw.js` on Windows — treat as environment issue, not source regression.
- Locale JSON: keep in `src/locales/` (bundled). `public/locales/` is URL-served legacy only.

---

## localStorage Keys (Reference)

| Key | Purpose |
|---|---|
| `freemannotes.workspace.selection.cache.v1` | Active workspace per user/device |
| `freemannotes.deviceAppearancePreferences.v2` | Device UI prefs (`userId::deviceId`) |
| `freemannotes.collapsibleHeadingPrefs.v1:${userId}::${deviceId}` | Collapsed heading IDs |
| `freemannotes.priorCollaborators.v1` | Privacy-scoped collaborator suggestions |
| `freemannotes.workspaceMembersCache.v1:<userId>` | Workspace members for @ dropdown; offline fallback |
| `freemannotes.pendingSelfMentions.v1:<userId>` | Optimistic self-mention inbox notifications (cleared on server match) |
| `freemannotes.reminderStates.v1.<userId>` | Reminder state cache |
| `fn_banner_warm_v1` | Banner warm cache (`noteId → bannerFile\|null`) |
| `freemannotes.overlay.history.v1` | App-managed overlay history |

---

## Quick Start

```bash
npm ci --legacy-peer-deps
cp .env.example .env
cp env.vite/.env.example env.vite/.env.development  # optional
npm run dev    # → Vite http://localhost:5173, API http://localhost:27016
npm start      # → http://localhost:27015 (production-like)
```
