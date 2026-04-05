# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## 1.1.39 - 2026-04-05

### Added
- **BubbleView cross-workspace notes overview.** A new bubble-layout mode for the note grid shows all notes as sized, floating circles. Importance is encoded by bubble size using an eight-class scale derived from pin status, reminder presence, recent edits, and collaborator count. Bubbles are arranged in a seeded organic scatter layout — each bubble uses a deterministic y-stagger, rotation, and float-animation timing derived from its id hash so the layout is stable across devices and re-renders. A zoom slider (also Ctrl+scroll / pinch) resizes all bubbles uniformly. Workspaces with the same note are distinguished with a subtle color border. Ghost-click prevention ensures iOS taps on animated bubbles do not accidentally open a note.

### Changed
- **Bubble activity scores converge smoothly for remote clients.** Rather than jumping to a new size class when a collaborator edits a shared note, scores are now advanced by a 1.5 s exponential-moving-average tick (α = 0.10) so size changes converge gradually over ~37 s instead of snapping.
- **Display-Size sliders use an explicit Save commit.** The Bubble Zoom and Font Scale sliders in Preferences → Appearance now show a live preview while dragging but only write to the database when the user presses Save. Closing or navigating back without saving reverts the sliders to their last committed values.

### Fixed
- **Bubble scores no longer inflate when a note is opened.** `lastAccessedAt`-only writes and empty Y.js transactions no longer advance `updatedAt`, preventing a note from appearing freshly edited simply because it was viewed.
- **iOS editor caret hidden under the keyboard.** After the iOS virtual keyboard animates in, a 320 ms delayed re-check of `ensureEditorSelectionVisible` scrolls the caret into view once the keyboard has fully settled.
- **Sidebar swipe gesture rubber-banded on iOS.** The open handler now sets a `didOpen` flag and always calls `preventDefault` while a touch is being tracked; the close handler sets `horizontalLocked` once vertical drift exceeds the threshold, which prevents an accidental dismiss when the user is scrolling vertically.
- **Bubble zoom slider drag unresponsive on iOS PWA.** WebKit's internal range-input drag handler is disabled by `touch-action:none`. Replaced with explicit `setPointerCapture` plus manual `clientX`-to-value computation so the slider responds correctly to touch-drag in standalone mode.
- **Editor toolbar double-counted the bottom safe area on iOS.** A duplicate `padding-bottom: env(safe-area-inset-bottom)` on `fullscreenOverlay` pushed the toolbar too far down; the redundant declaration was removed.
- **Checklist checkbox misaligned at non-default font scales.** Note-card checkboxes now use a scale-aware `calc(var(--note-card-font-scale, 1) * 0.675rem - 9px)` top margin so the checkbox centre tracks the first text line correctly at any font size.

## 1.1.33 - 2026-04-04

### Added
- **Persistent QR code share links.** The QR Code Invite section of the Share Note and Share Workspace modals now displays all previously generated, non-expired share links immediately when the modal opens — no regeneration required. Each active link shows its role badge and expiry, with Copy and View QR buttons. A count badge on the section header indicates how many active links exist. Links are stored in `localStorage` keyed by entity, role, and expiry, so a 7-day Viewer link and a 30-day Editor link are tracked independently and remain accessible until they expire.
- **Multi-link QR code list.** Generating multiple links for the same note or workspace (e.g. different roles or expiry windows) now produces a visible list entry for each unique combination rather than replacing the previous one.

### Fixed
- **iOS PWA never received app updates.** iOS Safari standalone mode does not reliably trigger the service worker `controllerchange` event or `window.location.reload()` in a frozen WKWebView. Added a `GET /api/version` endpoint and a polling loop in the PWA module that compares the server version to the build-time `__APP_VERSION__`. When a mismatch is detected, the app navigates via `window.location.replace('/')` which reliably escapes the frozen snapshot and loads fresh assets.
- **iOS bottom navigation bar transparency.** The system home-indicator / gesture bar area rendered transparent on iOS PWA, letting the note grid bleed through. Added a `::after` pseudo-element on `.test-harness-root` (mirroring the existing `::before` for the status bar) that fills the bottom safe-area inset with `--color-app-bg`.
- **Android navigation bar theme color.** The `meta[name="theme-color"]` value was using `surfaceColor` instead of `appBackground`, causing Android's system navigation bar to mismatch the app background. Corrected to use `appBackground` in `applyTheme()` and aligned the initial HTML value with the actual dark theme color.
- **Disclosure arrow misaligned in accordion headers without a count badge.** The chevron arrow on the "Send Invite", "QR Code Invite", and "Create User" section headers appeared beside the label text instead of at the right edge. Root cause: the `.sectionSummaryLabel` pill uses `max-width: fit-content`, so without a `summaryCount` element carrying `margin-left: auto` there was nothing to push the arrow right. Fixed with a `:has()` CSS selector that applies `margin-left: auto` to the arrow whenever no `summaryCount` sibling is present. Applied to all three accordion modal stylesheets.
- **Service worker `controllerchange` now uses `replace()` instead of `reload()`.** Changed the handler to use `window.location.replace(window.location.href)` for consistency with the network-version update path and improved iOS reliability.


### Added
- **Password reset by email link.** Users can now request a reset link from the login form, receive a one-hour password reset email, and securely choose a new password from the app.
- **Per-platform external notification delivery.** Server notification delivery can now be configured independently for Web, Android, and iOS with push, email, auto-fallback, or off modes, including branded reminder and test emails when SMTP is available.
- **Full-featured quick-create note editing.** New text notes and checklists now open as real notes immediately so reminders, labels, collections, collaborators, links, media, images, and editor undo/redo are available during creation instead of only after the first save.
- **Per-note auto-scroll toggle and note-card interaction preference.** Editors now expose an auto-scroll toggle, and Preferences now lets each device choose whether note cards open on tap or allow direct interaction with checklist items and links.

### Changed
- **Collection-aware note creation.** Creating a note while filtered to a collection now seeds the new note into that collection and shows an inline checkbox in the editor so it can be returned to Personal immediately.
- **Notification and upload UI polish.** Preferences now shows the effective delivery mode for the current platform, and file/image/avatar pickers now use explicit choose-file controls with clearer empty-state messaging.
- **Note presentation and bubble-view polish.** Note cards now clamp long checklist lines, show a softer overflow indicator, and optionally expose live checklist/link interaction, while bubble view better handles shared placements and uses the borderless bubble treatment.

### Fixed
- **Empty draft cleanup is now metadata-aware.** Auto-discard for newly created notes now preserves drafts that contain reminders, labels, collections, links, media, documents, or collaborator changes even when the text body is still blank.
- **Quick-create collection flow no longer breaks App hook order.** The selected-note metadata hook now stays in the stable top-level hook section, eliminating the runtime hook-order error introduced during the new collection-aware create flow.

## 1.1.31 - 2026-03-30

### Added
- **Workspace Images gallery.** Added a dedicated Images sidebar view that shows all visible note images in the current workspace with square thumbnails, shared filtering/sorting/grouping support, offline preview fallback, OCR-aware search, and full-image viewing.
- **Shared note-grouping utility.** Extracted reusable week/month grouping helpers so the main note grid and the new Images gallery stay aligned on section labeling and bucket boundaries.

### Changed
- **Images gallery cards are denser on mobile.** Thumbnail metadata now stays compact with just the note title, optional collection name, label and collaborator counts, and date, reducing vertical space usage on phones.
- **Images sidebar polish.** Removed the unused Archive sidebar entry and refined the gallery header into a compact sticky status bar while keeping active sidebar filters visible in the Images scope.

### Fixed
- **Bubble titles now refresh immediately after note edits.** Active-workspace bubbles now read the live note title/content from the note doc and resubscribe to title/content/checklist changes instead of relying on stale registry-only values.
- **Switching workspaces from Images no longer gets stuck or hangs on loading.** Workspace clicks now return to the notes view, and the underlying note grid stays mounted so workspace activation can still complete and dismiss the splash screen.

## 1.1.30 - 2026-03-30

### Added
- **Device-local note-card completed-state persistence.** Checklist note cards now restore the completed-items dropdown state immediately on the same device, including after reloads and offline restarts.

### Changed
- **iOS Safari and standalone mobile polish.** Updated viewport handling, safe-area layout, modal spacing, and note-card/checklist touch targets to behave more consistently on iPhone Safari and iOS installs.
- **List and strip drag interactions now animate like checklist moves.** Flat note rows now use neighbor-shift reorder animation, suppress accidental post-drop opens on touch, and clear selection more cleanly after mobile drag commits.
- **Completed-items controls on note cards are easier to use.** Expanded spacing, a clearer disclosure arrow, and larger invisible checkbox hit targets reduce accidental taps on mobile without changing the visible control sizes.

### Fixed
- **Bubble scoring no longer grows notes just from opening them.** Internal access/seeding writes are now excluded from note activity timestamps so bubble size reflects meaningful updates instead of editor/view lifecycle noise.
- **Bubble size is now consistent across devices.** Bubble importance no longer mixes in device-local activity storage, so the same note renders with the same weight everywhere.
- **iOS Safari refresh no longer jumps to a different workspace.** Startup now always seeds the local workspace-selection cache during auth/bootstrap flows, preventing refresh from landing on a transient server workspace left behind by background preload.

## 1.1.29 - 2026-03-29

### Added
- **Four note-grid view modes with persistence.** Added `Card`, `List`, `Strip`, and `Bubble` view modes with a dedicated top-of-grid toggle. The selected mode is stored locally per device and restored on next load.
- **List and strip layouts for notes.** `List` mode renders compact one-row notes (title + status badges), while `Strip` mode renders taller rows with a one-line content preview for faster scanning.
- **Cross-workspace bubble overview.** Added a new `Bubble` mode that visualizes notes from all accessible workspaces in a three-lane layout with size-weighted emphasis, workspace color distinction, and zoom controls (Ctrl+scroll or pinch).

### Changed
- **Grid rendering now supports mode-specific layouts.** The Note Grid now conditionally renders masonry cards or flat rows depending on active mode while preserving existing selection and more-menu behavior.
- **Localized view-mode labels.** Added English and Spanish locale strings for all view mode controls and accessibility labels.

## 1.1.28 - 2026-03-29

### Added
- **Per-user note color preferences.** Note background colors are now stored in each user's local device storage instead of the shared Yjs note document. Color choices are completely private — changing a note's color on one account no longer broadcasts the change to collaborators. Legacy color tokens already written to the Yjs doc remain visible as a migration fallback until the user makes a new selection.

### Fixed
- **Shared notes can now be drag-reordered.** Accepted shared notes silently snapped back to their original position after every drag. The note-order guard was treating shared note aliases as orphans (because they don't appear in the user's own notes registry) and deleting them from the order array on every render. Shared aliases are now whitelisted so committed drag positions are preserved correctly.

## 1.1.27 - 2026-03-29

### Added
- **Past-due reminder filter in two places.** Added `Past due` under both `Sorting > Filters` and `Reminders` so overdue reminder notes can be isolated quickly.
- **Sort-direction toggles for primary sort modes.** `Date created`, `Date updated`, and `Alphabetical` now support explicit ascending/descending direction with visible direction markers.

### Changed
- **Sort chips support in-place direction toggling.** The `Sort:` filter chip at the top of the notes grid is now interactive for toggleable sort modes, so direction can be flipped directly from the grid without reopening sidebar menus.
- **Mobile sidebar spacing and expansion behavior tuned.** Sub-item touch spacing was adjusted for coarse pointers while preserving tight vertical stacking; expanded sorting groups now remain visible without clipping inside an internal submenu scroller.
- **Workspace sidebar row simplified.** Removed the inline `- <active workspace>` text next to the `Workspace` top-level entry.
- **Redis deployment guidance clarified and enabled by default in compose.** Documentation and compose defaults now describe Redis as recommended for push badge reliability and required for multi-instance setups.

### Fixed
- **Mobile/PWA reminder notifications can now be cleared reliably.** Clear action enablement now respects pending reminder count in addition to currently loaded reminder rows, preventing disabled clear states when the count is non-zero.
- **Sorting submenu overlap/legibility issues.** Adjusted submenu row metrics and nested spacing to avoid overlap and preserve readability when multiple sorting sections are expanded.

## 1.1.26 - 2026-03-29

### Fixed
- **Notification bell badge now shows after re-scheduling a reminder.** When a note reminder fired, the user opened the notifications panel (which acknowledged it), and then re-scheduled a new reminder for the same note, the badge never showed again. The `PUT /api/push/reminder` upsert was not resetting `notificationAcknowledgedAt` in the update path, so the re-scheduled reminder's next firing still appeared acknowledged in the DB query. The upsert now explicitly clears `notificationAcknowledgedAt: null` on update, starting each new reminder cycle fresh.
- **Notification bell badge now updates in real time without Redis.** In single-instance deployments without Redis, the reminder scheduler had no way to push a `reminder-fired` WS event to open browser tabs directly — it only published to Redis (a no-op when Redis is absent). The scheduler now accepts an `onReminderFired` callback that performs both the in-process WS broadcast and the Redis cross-instance publish, following the same pattern as all other workspace-metadata events. The badge now refreshes the moment a reminder fires, even without Redis.

## 1.1.25 - 2026-03-29

### Fixed
- **Infinite WS reconnect storm with multiple tabs eliminated.** When a user has two browser tabs open on different workspaces and switches workspace in one tab, the JWT cookie is updated to the newly-active workspace. The other tab's Yjs providers then reconnect carrying the new JWT but with the old workspace's room prefix (e.g. `oldWorkspaceId:__notes_registry__`). The server's namespace check saw the prefix mismatch, found no `noteCollaborator` row for registry rooms, and closed the connection — which the client immediately retried, flooding the server with queries and causing the connection indicator to flicker indefinitely. The fix: when the room prefix doesn't match the JWT's active workspace, the server now first checks whether the user is a **member of the room's workspace** (the correct security boundary). If they are, the connection is allowed with their role in that workspace. Only if they are not a workspace member does the server fall back to checking for a shared-note collaborator entry.

## 1.1.24 - 2026-03-30

### Fixed
- **Bell badge now updates on all open tabs when a reminder fires.** Previously the notification bell only incremented on devices that actually received a push notification. The scheduler now publishes a `reminder-fired` workspace-metadata WS event (scoped to the owner) immediately after the push is sent. Any open browser tab for that user receives the event and calls `refreshNoteShareState` directly, updating the badge without waiting for a manual refresh or reconnect.
- **Notification panel now lists fired reminders.** The bell panel previously showed only share invitations and app updates — fired reminders never appeared as actionable entries. A new `GET /api/push/reminders/fired` endpoint returns the list of unacknowledged fired reminders (note title, due time). The notifications panel now renders a reminder section at the top; clicking **Open note** closes the panel and navigates to the note, switching to the correct workspace if needed.
- **Multiple reminder notifications no longer collapse into one.** All reminder push notifications previously shared the same `tag: 'freemannotes-reminder'`, meaning a second reminder would silently replace the first in the notification tray. Each reminder now uses a per-note tag (`freemannotes-reminder-{noteId}`) so they appear as distinct notifications.

## 1.1.23 - 2026-03-29

### Fixed
- **Note reminders now reliably fire push notifications.** The server-side scheduler previously only searched for reminders whose `reminderAt` was within the upcoming 60-second window (`gte: now`). Any reminder whose window had already elapsed — due to a row being created after the scheduler had already scanned that slot, or due to a server restart — was permanently missed. The query now uses only an upper bound (`lte: windowEnd`) so past-due unfired reminders are caught and fired immediately (0 ms delay) on the next cycle.
- **Notification bell now badges for fired reminders.** The in-app notification bell previously had no concept of reminders — it only counted share invitations and app updates. A new `notificationAcknowledgedAt` column on `NoteReminder` tracks whether the user has seen the in-app entry. Two new API endpoints (`GET /api/push/reminders/pending` and `POST /api/push/reminders/acknowledge`) expose the unacknowledged count. `refreshNoteShareState` now fetches this count in parallel with share data, and `totalNotificationCount` includes it. Opening the notifications panel acknowledges all fired reminders and clears the badge.

## 1.1.22 - 2026-03-28

### Added
- **Push notification system (VAPID / FCM).** New `server/pushService.js` delivers Web Push to browsers and PWA installs via VAPID, and Firebase Cloud Messaging to iOS Capacitor builds. A dedicated `server/pushRouter.js` exposes `/api/push/*` REST endpoints for subscription management, status and delivery-log retrieval, test notifications, and reminder registration. Three new Prisma models — `PushSubscription`, `PushNotificationLog`, and `NoteReminder` — back the feature (migration `phase17_push_subscriptions`). Environment variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` control which channels are active.
- **Notifications settings panel in Preferences.** A new `NotificationsSection` component renders under a Notifications tab in Preferences. It shows subscription status, recent delivery logs, and controls for subscribing, unsubscribing, re-registering, and sending a test push.
- **Server-side note reminder scheduling.** When a note reminder is set, the client syncs the reminder timestamp to the server via `PUT /api/push/reminder`. The server-side 60-second poll scheduler fires a push when the reminder time is reached even when the client is offline.
- **Push on workspace invite.** When a workspace invite is sent to an existing registered user, a push notification is immediately dispatched alongside the in-app invite event.
- **Push on note share.** Sharing a note with a registered user now fires an immediate push notification to the recipient.

### Changed
- **User Management modal uses accordion layout.** The Users list and Create User form are now independently collapsible disclosure panels, matching the design pattern of the Share Note and Share Workspace modals.
- **Admin user usage stats now report real image and file-storage totals.** The `/api/admin/users` endpoint previously hardcoded `images: 0` and `filesBytes: 0`. It now runs parallel `NoteImage` and `NoteDocument` Prisma aggregates per user and returns accurate counts and byte totals.
- **Manage Collections modal: clicking the active parent collection deselects it.** Previously there was no way to clear a parent selection from the tree picker without a separate button; clicking the highlighted item now toggles it off.
- **Collection tree sub-item path text removed.** The secondary path label (e.g. "travel / mexico") that appeared below each collection name in management modals has been removed.
- **Accordion section titles carry an accent-color pill.** The section summary label in all three accordion modals (Share Note, Share Workspace, User Management) renders with `--color-accent` foreground, tinted background, and a matching border for clearer visual hierarchy.
- **Trash note cards have full visual treatment and one-tap restore.** Trashed cards render desaturated, dimmed, and with content blur. Metadata chips are pointer-events disabled. A centered circular restore button overlays the card. Long-press still opens the more-menu on trash cards as on normal cards.

### Fixed
- **Admin panel always showed 0 images and 0 file bytes for every user.** Root cause: `adminRouter.js` set `filesBytes = 0` unconditionally. Fixed by adding parallel `noteImage.aggregate` and `noteDocument.aggregate` queries and computing real totals from the results.

## 1.1.21 - 2026-03-28

### Added
- **Collections, labels, and reminders for notes.** Added workspace-scoped metadata registries, note assignment flows, reminder scheduling, metadata chips, and explorer-style management modals for organizing notes beyond folders.

### Changed
- **Metadata-aware sidebar, filtering, and search.** Collections now render as a nested explorer in the sidebar and modals, active metadata filters show as removable chips, and global search now merges collection and label matches from both offline and server-backed results.
- **Sorting and grouping controls restored.** The Sorting menu again supports manual/date/alphabetical modes plus nested filter and grouping controls, and the note grid can render grouped sections such as This week and Last week.
- **Metadata modal and sidebar polish.** Metadata dialogs now share a compact tree picker system with internal scrolling, and nested sidebar submenu spacing was tightened for desktop and mobile layouts.
- **About hero ambient portrait overlay.** Added a faint right-side `FreemanFace` graphic in Preferences > About to reinforce branding without overpowering the primary icon and copy.
- **About HUD layout and metric grouping refinement.** Rebalanced About telemetry so top-row labels render more cleanly and bottom-row metrics are split into left/right groups (`Health`, `Memory` on the left; `Uptime`, `Users` on the right).
- **HL2-inspired telemetry palette tuning.** Restored a stronger classic amber/yellow HUD look while retaining theme-aware blending so labels remain legible across custom light/dark palettes.

### Fixed
- **WebSocket forbidden-namespace reconnect spam.** Session/bootstrap refresh now disables Yjs websocket sync before switching the client manager to a different workspace, preventing registry reconnect storms and repeated Prisma authorization queries.
- **Attachment chip and metadata overlay stability.** Attachment counts now perform a guarded initial remote refresh when local state is empty, and note-card metadata/attachment overlays close more reliably across modal, blur, and visibility transitions.
- **Manage Collections disclosure icon distortion.** Shared metadata modal tree icons now keep the correct aspect ratio, and the Manage Collections, Add Labels, and Add to Collection dialogs scroll cleanly when content grows tall.
- **Live health state now follows connection status.** About health values now react to app connectivity transitions (`100` connected, `50` connecting, `25` offline) and refresh with telemetry polling.
- **About icon recovery after offline transitions.** The About application icon now retries cleanly when reconnecting instead of remaining broken after an offline error.
- **Missing desktop telemetry labels.** `Images`, `Docs`, and `Workspaces` now render as first-class HUD cells across desktop and mobile instead of collapsing into an inconsistent wrapped footer line.
- **Mobile icon edge clipping in About.** Switched the About app icon rendering to fit without side crop on narrow screens.

## 1.1.20 - 2026-03-28

### Added
- **Workspace note move modal with offline-safe replay.** Added a dedicated Move Note flow plus a local pending-move queue that records note transfers while offline and replays them when connectivity returns.
- **About telemetry HUD.** Preferences > About now includes a live status strip backed by a new authenticated `/api/system/hud-stats` endpoint exposing uptime, storage, and usage totals for signed-in users.

### Changed
- **Trash retention preference now supports "Never" with constrained presets.** User preferences now accept `7`, `14`, `30`, or `Never` (`null` in API payloads / `0` persisted server-side), and client parsing was updated to treat unset retention as `null` instead of forcing a numeric default.
- **About section visual redesign.** The About panel now uses the updated branding layout, compact HUD typography, and a dedicated bottom-left numeric health indicator (`100/50/25`) to preserve one-row metric density on mobile.
- **Trash view interaction model.** Trash scope now uses restore-first actions, read-only-safe note-card behavior, and updated menu/action wiring to match archive/trash context expectations.

### Fixed
- **Auto-delete cleanup respects disabled retention.** Scheduled trash cleanup now exits early when retention is disabled and logs the skipped cycle.
- **Expired-share token cleanup on permanent trash deletion.** Cleanup now removes related note share tokens before deleting expired documents to prevent dangling share records.
- **Mobile note interactions and menu consistency.** Addressed touch/menu edge cases in note cards and more-menu behavior that could conflict with trash-mode actions.

## 1.1.19 - 2026-03-27

### Added
- **Per-device display-size controls for notes.** Added appearance settings for note-card text size, note-editor text size, and maximum note-card height, backed by local cached preferences, server preference sync, and Prisma migrations.
- **Semantic note color themes.** Notes can now store a theme-aware color token that recolors cards, editors, collaborator overlays, and attachment chips without persisting raw color values.

### Changed
- **Editor title fields now auto-grow and wrap.** Text and checklist editor titles use autosizing textareas with reserved trailing space for upcoming action icons.
- **Checklist editing flow is more caret-aware.** Pressing Enter inside a checklist row now splits content at the caret into a new row while preserving rich-text content and hierarchy.

### Fixed
- **Simultaneous note-card taps no longer open multiple editors.** The card open gesture now claims a single touch interaction and suppresses competing touches until the gesture resolves.
- **Mobile shell navigation is more consistent.** The sidebar edge swipe now works from a fresh app state, mobile search participates in overlay history, Android Back closes search, and iOS/PWA has an explicit close path.
- **Reserved workspace names are blocked.** Workspace creation and rename now reject duplicate names case-insensitively, including the built-in `Personal` and `Shared With Me` labels and their legacy stored forms.
- **Notification and checklist polish.** Unified bell copy now says `Notifications`, multiline checklist rows have more breathing room, and wrapped title/checklist interactions behave correctly on mobile.

## 1.1.18 - 2026-03-27

### Fixed
- **PWA icon renders correctly on all Android launchers and iOS.** The source icon is white/light on a transparent background; adaptive-icon launchers (and iOS) fill transparent areas with their own colour (often white), making the logo invisible. Added `purpose: "maskable"` icon variants (`pwa-192x192-maskable.png`, `pwa-512x512-maskable.png`) that have an opaque `#0b0f16` background with the logo scaled to fit the inner 80% safe zone. The web manifest now declares four entries: the original transparent icons with `purpose: "any"` (for contexts that preserve transparency) and the new opaque icons with `purpose: "maskable"` (for adaptive launchers). The `apple-touch-icon.png` was also replaced with the opaque 180×180 variant — iOS always adds a white layer behind transparent touch icons.
- **App name corrected to "Freeman Notes".** The installed PWA label, page title, Apple touch icon title, and in-app update notifications previously read `FreemanNotes` (one word), which caused it to be clipped as `FreemanN…` on launcher home screens because the OS had no word-break point. Corrected to `Freeman Notes` everywhere (manifest `name`/`short_name`, `<title>`, `apple-mobile-web-app-title`, notification strings). Technical identifiers (package name, storage keys, DB names) are unchanged.

### Added
- **`scripts/generate-maskable-icons.mjs`** — utility script that regenerates the maskable icon variants and `apple-touch-icon.png` from the source `pwa-512x512.png` using `sharp`. Re-run this whenever the source icon is updated.

## 1.1.17 - 2026-03-27

### Fixed
- **Infinite DB call storm when Share Workspace modal is open.** The `onInviteChanged` event handler in `SendInviteModal` was calling `loadInviteState(false)` (server fetch) in response to `WORKSPACE_INVITE_STATE_EVENT`, which fires after every local IndexedDB write. The server fetch wrote to IDB, re-emitted the event, and created an unbounded loop that exhausted the PostgreSQL connection pool over time. Fix: the handler now calls `loadInviteState(true)` (cache-read only), since the event signals "local cache updated" not "server has new data."
- **Personal workspace not pinning to top of sidebar and switcher.** The `systemKind === 'PERSONAL'` check never matched because personal workspaces have `systemKind: null` in the database — they are identified by name pattern `Personal (<userId>)`. Added `isPersonalWorkspace()` to `workspaceDisplay.ts` and used it in both the sidebar sort and the workspace switcher modal.
- **Misleading "check cookie/reverse-proxy" error after server overload.** The auth error shown when `/api/auth/me` fails after a successful login POST now reads "server may be temporarily unavailable — please try again" before suggesting proxy/cookie configuration.

### Changed
- **Manage Workspaces button moved to sticky top of workspace dropdown.** Previously at the bottom of the scroll container, it is now pinned above the list so it is always reachable regardless of workspace list length.
- **Manage Collections button mirrored to sticky top of Collections dropdown.** Same pattern applied to the Collections sidebar submenu.
- **Sidebar submenus are now bounded scrollable regions.** Both workspace and collections submenus have `max-height` and `overflow-y: auto` so long lists scroll within the sidebar instead of overflowing it.
- **Mobile sidebar scrollbars hidden.** On touch devices, `scrollbar-width: none` and `::-webkit-scrollbar { width: 0 }` suppress overlapping scrollbar chrome inside the sidebar.
- **Share icon redesigned for mobile.** The workspace share button is now a transparent icon-only button with accent highlight on hover/focus. On desktop it appears only on row hover; on mobile it is always visible at reduced visual weight.

## 1.1.16 - 2026-03-27

### Added
- **Background workspace preload for full offline coverage.** When the app comes online (or 5 seconds after login), a background loop iterates every workspace the user belongs to, activates each one server-side, and pulls its complete registry + all notes into IndexedDB via temporary Yjs providers. This ensures every workspace is available offline even if the user has never visited it on this device.
- **Dedicated workspace-selection cache (`workspaceSelectionCache.ts`).** A new localStorage key (`freemannotes.workspace.selection.cache.v1`) tracks the user's last chosen workspace independently of the auth-session cache. It is written on every workspace switch (including offline switches) and is read at startup before the server session is restored, so the locally-selected workspace is never overwritten by a stale server response.

### Fixed
- **Offline edits from multiple workspaces now sync on reconnect.** Previously only the server's last active workspace was flushed on reconnect; offline edits made in any other workspace were silently lost until the user manually switched back. The reconnect path now calls `indexedDB.databases()` to discover every workspace with local data, activates each in sequence, and flushes pending Yjs updates before activating the final target workspace.
- **WebSocket "forbidden namespace" storm eliminated.** WebSocket sync is now held disabled until the server session is successfully activated to the target workspace. Opening WS rooms before activation completed caused the server to reject every message with `1008 forbidden namespace`, triggering an unrecoverable reconnect loop.
- **Workspace label no longer flips on reconnect.** `refreshActiveWorkspace` now skips updating the displayed workspace name if the server returns a different workspace ID than the locally-selected one, preventing a transient flash of the old workspace name during the activation handshake.
- **Offline workspace switch no longer reverts on page refresh.** The service worker can serve a cached `/api/auth/me` response while the backend is unreachable; the app previously interpreted this as a successful online probe and reverted to the server's (stale) workspace. Network errors during workspace activation are now distinguished from server rejections — a network error triggers offline mode while preserving the locally-selected workspace.
- **IndexedDB snapshot no longer overrides an already-determined workspace.** The `loadSidebarWorkspaces` hydration path now only falls back to the IndexedDB active-workspace snapshot when no workspace is set at all, preventing a race where a stale IDB timestamp caused an already-resolved offline switch to be reverted.
- **`DocumentManager.discoverLocalWorkspaceIds()`.** New public method enumerates all `${workspaceId}:${docId}` IndexedDB databases and returns the unique workspace ID prefixes, with graceful fallback when `indexedDB.databases()` is unavailable.
- **`DocumentManager.flushPreviousWorkspaceEdits()`.** Verifiably flushes offline Yjs edits for a no-longer-active workspace: opens isolated temporary IDB + WS providers, waits for the Yjs state-vector exchange, then tears them down — without interfering with the active workspace's providers.
- **`DocumentManager.preloadWorkspaceFromServer()`.** New public method syncs a workspace's full dataset (registry then all notes) from the server into IndexedDB using temporary providers, enabling offline access to workspaces that have never been opened on the current device.

### Changed
- **Workspace switcher pinning order.** The workspace switcher now always shows Personal first, then Shared-With-Me, then user-created workspaces. The active workspace within the user-created group floats to the top.
- **`systemKind` values normalized to uppercase.** `mapWorkspaceList` and `mapWorkspaces` now call `.toUpperCase()` on `systemKind` so PERSONAL / SHARED_WITH_ME comparisons are case-insensitive against any server casing.
- **`onOnline` handler always probes session.** The `probeSession` call is no longer gated on `authOfflineMode`; any workspace switch made while online-but-later-going-offline also needs server re-activation on reconnect.
- **Background preload is aborted on manual workspace switch.** `handleWorkspaceActivated` increments `backgroundPreloadAbortRef` so a user-initiated switch immediately cancels any in-progress preload cycle, preventing the restore activation from clobbering the new selection.
- **Sidebar workspace name display styles.** Added `sidebar-workspace-inline-summary`, `sidebar-workspace-inline-label`, `sidebar-workspace-current-inline-text`, and `sidebar-workspace-manage` CSS classes to support the updated inline workspace name layout in the sidebar.

## 1.1.15 - 2026-03-26

### Fixed
- **Offline open/close no longer spams sync work.** Opening and closing notes while offline no longer triggers redundant sync churn, and reconnect refresh behavior is now scoped to the changed attachment domain.
- **Attachment chips and overlays are stable on mobile.** Expanded chips now close safely via Android Back, avoid click-through to underlying notes, keep active cards above blur layers, and prevent off-screen dropdown placement.
- **Collaborator/media panel scroll interactions.** Expanded chip and media panel interactions now isolate internal scrolling and stop accidental page/grid scroll or unintended dismisses.
- **URL preview rail spacing on note cards.** Mobile note-card URL previews now sit flush to the card bottom with the gap removed.
- **Drag freeze near top edge.** Drag bounds now clamp correctly against section/scope geometry so dragging to the top edge no longer stalls or locks.
- **Realtime attachment update reliability.** Metadata fanout and attachment refresh pathways now propagate link/document/media count updates more reliably across clients.
- **Image viewer swipe transition artifact.** Swiping to adjacent images in the viewer no longer flashes the previous frame before the next frame renders.
- **Media panel visual noise reduced.** Removed the default `synced` status line and removed OCR thumbnail chips from image tiles.
- **Media panel caret bleed-through.** Caret visibility is now suppressed while the media sheet/flyout is open.

### Changed
- **Media sheet tab transitions.** Added animated transitions for media tab changes across note, checklist, and text editors.
- **Attachment browser modal shell.** Mobile attachment browser modal now uses safer backdrop press semantics and a dedicated handle affordance.
- **Editor/mobile spacing and sheet polish.** Updated layout spacing and sheet styling to keep scope/header/card geometry consistent on small screens.
- **Localization and rich-text support refinements.** Updated i18n and rich-text handling paths touched by the media/editor interaction fixes.

## 1.1.14 - 2026-03-26

### Fixed
- **Offline image uploads no longer appear stuck.** File uploads now queue immediately offline, close the modal without a hanging spinner, and replay reliably on reconnect.
- **Theme preferences now apply while offline.** Local theme changes are applied and persisted instantly, then synced back to user preferences once connectivity returns.
- **Offline image previews keep sharp framing.** Cached/queued media thumbnails now preserve aspect ratio and improved progressive quality so note image tiles stay clear and correctly cropped offline.
- **Workspace renaming now works offline.** Renames are queued, applied to cached workspace snapshots immediately, and replayed to the server on reconnect.
- **URL preview metadata now hydrates after offline reconnect.** Link sync now uses queue-aware reconnect retries, deduplicated background hydration, and placeholder-safe merge rules so metadata resolves without requiring a manual page refresh.

## 1.1.13 - 2026-03-16

### Added
- **Bell-based app update notifications.** Available app updates and post-update confirmations now appear in the main notifications modal so update status is visible alongside invites and link issues.

### Changed
- **Safer automatic PWA updates.** Service-worker refreshes now wait until the app is idle or no longer blocked by active editors and modals before applying automatically.
- **Android launch icon metadata.** The web manifest now advertises the standard 192px and 512px app icons as both regular and maskable-capable launch assets so Android can use the current primary branding during install and startup.

## 1.1.12 - 2026-03-16

### Changed
- **Subtle header connectivity indicator.** The app icon now carries a thin status line that stays invisible while connected, uses the active theme accent while reconnecting, and switches to a soft animated red scan when the app is offline.

## 1.1.11 - 2026-03-16

### Added
- **Dedicated User avatar settings.** Preferences now exposes a User section with a standalone avatar editor modal that reuses the registration crop flow for profile photo updates.

### Changed
- **Shared avatar crop plumbing.** Avatar image preparation now runs through a shared client helper so registration and in-app profile edits follow the same crop and export behavior.

### Fixed
- **Immediate avatar refresh after save.** Saving a profile photo from Preferences now updates the current session avatar immediately and keeps the cached authenticated profile in sync.
- **Realtime collaborator avatar propagation.** Profile image uploads now publish targeted metadata events so connected collaborators refresh user avatars without opening another screen or reloading.

## 1.1.10 - 2026-03-16

### Changed
- **PWA install identity.** Android install metadata now uses `FreemanNotes` for both the app name and short name, and the web manifest advertises the standard 192px/512px icons instead of the maskable icon set.

### Fixed
- **Link-preview image hydration.** Note-card URL preview rails now background-refresh incomplete cached preview rows, and the server rehydrates stale link preview metadata on fetch so hero images appear without opening the editor first.
- **Docker avatar upload reliability.** Post-registration avatar uploads now wait for the authenticated session to be confirmed before sending the multipart request, reducing missed writes in container deployments.
- **Docker upload diagnostics.** Container startup now warns when the configured upload directory is not writable by the runtime user, making bind-mount permission problems visible immediately.

## 1.1.0 - 2026-03-16

### Added
- **Progressive Web App support.** Added `vite-plugin-pwa`, an installable web manifest, generated app icons, a custom service worker, offline-ready/update state, and install flows for both prompt-capable browsers and iOS Safari.
- **Queue-aware offline sync bridge.** Existing note, link, document, media, and collaborator offline queues now request background sync through the shared PWA client/service-worker path instead of waiting only for foreground reconnects.

### Changed
- **Preferences install surface.** Preferences now only shows app-install actions when installation is actually available, with browser-specific instructions and mobile-safe modal overflow handling.
- **Production avatar freshness.** Profile image uploads now return cache-busted URLs so a newly registered avatar appears immediately in Docker and other long-cache deployments.
- **Collaborative preview hydration.** Note-card link rails now treat live Yjs link metadata changes as a signal to refresh cached remote previews, so collaborators see preview content update without a manual reload.

### Fixed
- **Offline navigation and caching behavior.** The service worker now preserves an app-shell fallback for navigations, keeps API/image caching scoped by intent, and avoids filling image cache storage with oversized local originals.
- **Remote link-preview propagation.** Server-fetched link preview records now emit the same change event as local queue writes, keeping rails, panels, and fresh devices in sync after remote refreshes.
- **WebP avatar delivery.** Production upload serving now advertises `image/webp` correctly for normalized profile photos.

## 1.0.98 - 2026-03-16

### Added
- **Unified selected-text copy conversion.** Full text editors now support copying the active selection as either Markdown or Rich Text using shared conversion utilities that are also scaffolded for browser extension, Android, and iOS reuse.
- **Offline note search coverage.** Search now falls back to local note, OCR, document, link-preview, and collaborator caches when the app is offline.
- **Doc-viewer based document reader.** Document browsing now uses `@iamjariwala/react-doc-viewer` with cached blob resolution, built-in annotation persistence, and safer fallback download handling for unsupported formats.

### Changed
- **Text editor copy UX.** The previous selection bubble copy flow has been replaced with toolbar copy-mode toggles, desktop/mobile shared state, a heading dropdown, and copy-mode toasts that align with normal keyboard/browser copy behavior.
- **Document availability controls.** Document-add entry points now show temporary Coming Soon states while existing document browsing remains available through the new viewer pipeline.
- **Offline/media refresh behavior.** Note-card attachment and link-preview surfaces now avoid unnecessary remote refreshes during drag/reorder work while still allowing one-time hydration on fresh devices.

### Fixed
- **Mobile copy-mode parity.** Floating mobile toolbars now default to Rich Text, stay in sync with the underlying editor state, and render copy-mode status toasts above the visible toolbar.
- **Clipboard fidelity.** Markdown and rich-text copy conversion now preserve block structure, line breaks, tables, and task-list markers more reliably across paste targets.
- **Fresh-device and offline preview hydration.** Link preview art, cached document blobs, splash timing, and document-viewer refresh behavior now better tolerate cold starts, websocket nudges, and offline reopen flows.

## 1.0.97 - 2026-03-14

### Added
- **Document attachments with in-app browsing.** Notes can now carry PDFs and office-style documents with upload queues, OCR-backed text extraction, generated previews, and dedicated image/link/document attachment browsers.
- **Link preview infrastructure.** Notes now persist URL preview metadata, resolve richer site cards server-side, surface failed preview notifications, and expose link management in cards, editors, and note menus.
- **Attachment-aware note chips.** Note cards now use a single attachment chip that expands into images, links, and documents instead of competing for limited chip space.

### Changed
- **Rich-text editing breadth.** Editors now support broader Markdown paste conversion, task lists, tables, blockquotes, code blocks, horizontal rules, extra heading levels, and URL-preview insertion directly from the toolbar.
- **Note-card preview fidelity.** Cards now render richer text structures, compact table summaries, tighter link rails, and consistent attachment/browser styling across desktop and mobile.
- **Grid ordering durability.** Drag-and-drop now preserves intended column placement more reliably across devices by syncing column slots alongside reading order.
- **Release documentation.** Updated code comments across the new attachment, document, link-preview, and modal plumbing, plus refreshed top-level project docs for self-hosted deployment.

### Fixed
- **Drag-and-drop stability regressions.** Fixed post-drop reshuffling, tall-card placement drift, and horizontal swaps that triggered before the dragged card visually crossed columns.
- **Editor and modal scroll behavior.** Hidden editor scrollbars now stay scrollable, the background grid stops scrolling while editors are open, and mobile attachment/document modals properly lock background scroll.
- **Preview hydration and collaboration polish.** Fixed rich preview materialization after reload, collaborator modal access-state timing, viewer-role media visibility, and several mobile editor/caret interaction edge cases.

## 1.0.95 - 2026-03-13

### Added
- **Durable offline image previews.** Viewed note images now fall back through service-worker cached full images, IndexedDB-backed preview blobs, and explicit placeholders so media stays understandable offline after reloads.

### Changed
- **Realtime media refresh routing.** Note-media websocket nudges now stay scoped to media state, coalesce burst deletes per note, and update note chips across devices without repainting the rest of the workspace UI.
- **Mobile media viewer polish.** The fullscreen image viewer now relies on Back-only dismissal, keeps its header actions stable on coarse-pointer layouts, and surfaces offline-preview context inline.

### Fixed
- **Image and collaborator chip hydration.** Note cards now resolve shared aliases back to source room IDs, refresh image counts on first paint, and hydrate collaborator chips correctly on fresh devices and same-user multi-session setups.
- **Offline media controls.** Remote thumbnail delete affordances remain enabled offline so queued image removals can be staged directly from the gallery.

## 1.0.94 - 2026-03-12

### Added
- **Image uploads, galleries, and OCR search.** Notes now support file and URL image imports, thumbnail galleries, fullscreen viewing, server-side OCR extraction, and global search matches that include extracted image text.
- **Offline-safe media staging.** Added IndexedDB-backed upload and delete queues so note media changes appear immediately offline and replay once connectivity returns.
- **Archive-aware media/search plumbing.** Note metadata, search grouping, and image result routing now include archive state alongside Personal, shared, and workspace note locations.

### Changed
- **Mobile media navigation.** Image viewers and note media sheets now use layered history tokens, swipe navigation, and explicit close routing so Back closes the top-most media surface before unwinding the editor.
- **Search result context.** Workspace labels, collaborator matches, and image-result placeholders now render clearer prefixes, hide raw UUIDs, and open directly into the relevant note or media browser.
- **Container OCR runtime.** Docker packaging and compose defaults now ship the Python/PaddleOCR runtime and OCR environment wiring required for note-image processing in production.

### Fixed
- **Shared-note placement visibility.** Notes accepted into Personal or other workspaces now render in the active workspace view instead of only under Shared With Me.
- **Collaborator chip and modal correctness.** Shared-note collaborator summaries now exclude self from note-card chips, preserve owner labeling, and avoid inherited-workspace mislabeling for recipients.
- **Media viewer regressions.** Fixed mobile tap/click conflicts, fullscreen stacking, zoomed viewer gestures, and editor/media back-stack crashes introduced during the image browser rollout.

## 1.0.93 - 2026-03-11

### Added
- **Collaborator note chips and filter flow.** Note cards now surface collaborator count chips, open a collaborator picker overlay with avatar rows, and let users filter the notes grid by collaborator directly from the card.
- **Docker beta deployment assets.** Added a container entrypoint, deployment env template, persistent upload volume wiring, and hardened Docker packaging for beta self-hosting.
- **GHCR publish workflow.** Added a GitHub Actions workflow that builds the root Dockerfile and publishes `ghcr.io/daxtond/freemannotes:latest` on every push to `main`.

### Changed
- **Collaborator overlay UX.** The collaborator picker now uses a compact staged hopscotch animation, caps growth after ten collaborators, and hides native scrollbars while preserving touch and wheel scrolling.
- **Deployment documentation.** Docker and beta-hosting docs now reflect the automatic database bootstrap path, required runtime secrets, and the new GHCR image publishing flow.

### Fixed
- **Mobile note chip spacing and density.** Note-card chip rails now fit tighter mobile layouts, preserve finger-friendly spacing above note content, and keep overlay rows aligned to the panel width.
- **Docker runtime defaults.** The shipped container now prepares its upload directory at startup and keeps runtime configuration out of the image via deployment env files.

## 1.0.92 - 2026-03-11

### Added
- **Identifier-based workspace invites.** Workspace sharing now accepts either a username or an email address, resolves existing accounts for in-app delivery, and keeps the offline invite queue aligned with the same identifier-based flow.
- **Password confirmation and strength guidance.** Registration and admin password reset now include confirm-password entry plus a shared password-strength indicator backed by the same client/server policy.

### Changed
- **Admin password reset workflow.** User management now opens a dedicated reset modal that sets the new password directly instead of generating a temporary password.
- **Release documentation.** Added targeted implementation comments across the new workspace-invite, activation, and password-policy paths introduced in this patch release.

### Fixed
- **Workspace activation hydration.** Accepting or activating a workspace now confirms the server session before reconnecting realtime state so notes appear immediately without a manual refresh.
- **Collaboration and invite polish.** Note collaborator lists now surface workspace-inherited access correctly, stale online member mutations no longer fail on cached roles, and the share-workspace label layout no longer overlaps the identifier input.

## 1.0.91 - 2026-03-11

### Added
- **Workspace sharing and invite management.** Added secure workspace share links, richer invite delivery paths, invitation notifications, workspace member management, and offline-safe invite replay plumbing.
- **Role-aware workspace access controls.** Added shared workspace role helpers across the client and server so `OWNER`/`ADMIN`/`EDITOR`/`VIEWER` behavior stays consistent for navigation, editing, sharing, and websocket sync.
- **Release documentation for new interaction paths.** Added targeted comments across the newest sidebar focus handling, rich note-card preview rendering, and editor backdrop guards.

### Changed
- **Sidebar and modal polish.** The workspace submenu now restores focus safely when hidden, the desktop sidebar flyout is wider, dropdown text sizing is aligned, and workspace share affordances now sit inside the workspace row on desktop and mobile.
- **Sharing UX.** Workspace and note sharing now support QR/link flows, in-app invite delivery, collaborator/mobile history integration, pending invitation review, and protected handling for system workspaces.
- **Note preview fidelity.** Note cards now render rich text formatting, list markers, links, and alignment from stored TipTap/Yjs content while flattening headings for compact previews.

### Fixed
- **Collaborator and invite mobile regressions.** Fixed oversized mobile dropdowns, mobile back-button behavior for collaborator flows, and the more-menu history conflict that could hide the collaborator modal.
- **Rendering and selection stability.** Fixed the React snapshot loop behind error 185, prevented accidental editor close when text selection ends outside the overlay, and kept note-card checklist text in sync with rich content.
- **Workspace safety and access correctness.** Prevented deletion of protected Personal and Shared With Me workspaces and enforced read-only behavior for viewer access in editors, cards, and websocket sync.

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
