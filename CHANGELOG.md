# Changelog

All notable changes to this project are documented in this file.

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
