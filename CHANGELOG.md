# Changelog

All notable changes to this project are documented in this file.

## Unreleased

## 1.6.7 - 2026-07-08

### Fixed
- **Inbox cards disappear offline.** When the device went offline, the Inbox feed blanked (showed "Sector clear") even when the user had existing unread cards. The filter-change effect cleared `activities` before fetching, and the offline fetch returned nothing — leaving the list empty. Fix: InboxView now maintains a per-filter in-memory cache (`cacheRef`). On tab switch, cached activities are displayed immediately. A background fetch refreshes the cache when online; if offline, the last-known activities remain visible.
- **Inbox tab switching caused "Loading" flash + freeze.** Every tab press blanked the list and showed a spinner for the duration of the network round-trip. Offline, the spinner persisted indefinitely (browser-level request timeout). Fix: loading spinner is now suppressed whenever the filter has cached data; a 5-second `AbortController` timeout is applied to every fetch so the UI always resolves promptly.
- **@mention chip pulses every time a note is opened after inbox navigation.** Clicking an inbox activity card sets `pendingMentionScrollNodeId` in App state to scroll the editor to the mentioned chip. This value was only cleared by the explicit close-note path, not the mobile back-button path (`applyOverlaySnapshot`), so it persisted across subsequent note opens and pulsed the chip again each time. Fix: a `useEffect` watching `selectedNoteId === null` clears the scroll nodeId whenever the editor closes, regardless of how it closes.

## 1.6.6 - 2026-07-07

### Fixed
- **Offline self-mention: broken avatar on reconnect.** When a user mentions themselves while offline, the Yjs state syncs back to the server on reconnect via `messageYjsSyncStep2`. The server only called `recordDocUpdate` (which sets the activity's actor ID) for `messageYjsUpdate` messages, leaving `actorId = null` for sync-back updates. The Activity row was created with a null actor, so the inbox card showed initials instead of the user's avatar. Fix: also call `recordDocUpdate` for `messageYjsSyncStep2`, since the authenticated WS connection's userId is definitively the author of those accumulated changes.
- **Offline self-mention: no notification while offline.** Self-mentions created while offline produced no inbox notification (the server-side activity pipeline only runs on WS sync). An optimistic pending notification is now created client-side immediately when a user inserts an @self chip. The pending card appears at the top of the Inbox feed with the user's current avatar and note title. When the server creates the real Activity on reconnect, the pending card is replaced automatically (matched by the reference node's UUID). Clicking or swiping a pending card opens the note / dismisses the notification. Pending entries are persisted to localStorage (userId-scoped) so they survive page reloads while offline.
- **Bell notification panel hides inbox section while offline with pending self-mentions.** `ShareNotificationsModal` received `inboxUnreadCount` from the server (always 0 while offline), so the inbox preview section was hidden even when pending self-mention badges were showing. The prop now includes pending self-mention count so the inbox section appears while offline.
- **@ mention dropdown empty after cache-clear + going offline.** `UserReferenceProvider` held workspace members only in an in-memory module cache that was lost on page reload and was never populated proactively. After a cache clear, typing `@` while offline returned an empty list until the user had typed `@` at least once while online. Fix: workspace members are now persisted to userId-scoped localStorage (`freemannotes.workspaceMembersCache.v1:<userId>`) and restored into the in-memory cache on login (`initWorkspaceMembersCacheForUser`). A proactive background fetch runs on every login so the cache is current before the user types `@`. `refreshUserAvatarsCache` no longer pre-clears the cache before fetching — it updates in-place so the dropdown is never empty during a mid-session refresh.

## 1.6.5 - 2026-07-05

### Added
- **Import system.** Notes can now be imported from Google Keep Takeout ZIPs, plain Markdown files, and other supported formats. A new import UI (`ImportModal` → `ImportVerificationModal`) parses the archive, previews the notes, and writes them as Yjs documents. After import a full-screen "Syncing notes…" overlay (with live progress counter) covers the grid until all WS docs are confirmed received — the shimmer stall timeout is extended to 3 minutes for freshly-imported workspaces so the grid never shows a half-loaded state.
- **Export note.** "Export note" action added to the note card more-menu. Exports the current note as Markdown (rich-text and checklist) or native Excalidraw JSON (drawing notes).
- **Welcome note for new users.** When a new account is created, `server/seedWelcomeNote.js` inserts a pre-written rich-text note into the workspace so first-time users land on a non-empty grid. Non-fatal: if seeding fails the registration still succeeds.
- **Freeman theme family.** Six new Half-Life–inspired themes added to Appearance preferences under a "Freeman" category: Black Mesa, Xen, City 17, G-Man, Combine, and Freeman. Theme category selector updated with a "Freeman" group. Labels strip the redundant "Freeman:" prefix in the picker list.
- **Live avatar updates.** Profile picture changes now propagate in real-time to every @mention chip and note card preview without a page reload. `liveUserAvatarCache.ts` is a reactive module-level store; `useLiveUserAvatar` (per-user, used in `ReferenceChip`) and `useLiveAvatarUrlLookup` (global, used in `NoteCard`) subscribe at different granularities to minimise re-renders. `profileRouter.js` now emits `changedUserId` + `profileImageUrl` in the workspace metadata event so all connected clients update immediately.
- **Rich-text link menu with heading anchors.** The toolbar's link button now opens a floating menu that shows the current href and a list of all headings in the document as anchor targets. Clicking a heading entry sets the link to `#slug` (GitHub-style slugification). The menu positions itself above the keyboard on mobile. Heading slugs are resolved against the live ProseMirror doc rather than DOM IDs to avoid timing dependencies on the MutationObserver.
- **In-editor TOC navigation.** When an editor opens with a pending mention scroll (`scrollToMentionNodeId`), or when a `#slug` link is activated inside the editor, `scrollToSluggedHeading` walks the ProseMirror tree, finds the matching heading by slug, and calls `scrollIntoView`. The editor is blurred before scrolling on mobile to prevent the browser cursor-chase from fighting the programmatic scroll.
- **Inbox scroll-to-mention.** Clicking "View" on an inbox activity card that contains a `deepLink.nodeId` now passes `scrollToMentionNodeId` into the editor, which scrolls and highlights the @mention node automatically.
- **Self-mention shortcut.** Mentioning yourself in the @ dropdown skips the role-picker step and inserts the chip directly as EDITOR.

### Changed
- **Sidebar "Notes" entry shows workspace name.** The generic "All Notes" sidebar entry now displays the active workspace name with a small "WORKSPACE" eyebrow label above it. Bubble view keeps "All Notes" since it spans all workspaces.
- **Scope chip label simplified.** The top-of-grid scope chip no longer shows "All Notes / Workspace Name" — it shows just the workspace/path string, matching the sidebar change.

### Fixed
- **"Move to Trash" reopens the note editor on mobile (touch devices).** On coarse-pointer devices `NoteCardMoreMenu` pushes a `{__moreMenu}` entry to browser history; its cleanup calls `history.back()` which fires a `popstate` that races with `closeNoteEditor()`. The popstate handler now checks whether the note being restored is already trashed in its Yjs doc; if so, it applies a grid snapshot instead and `replaceState`s the stale overlay entry so forward/back navigation stays clean.
- **TOC fragment links in note card previews cause navigation.** Clicking a `#heading-id` link in a card's rich-text preview caused the app to reload (the fragment resolved against the outer document). `getSafeHref` now blocks any href beginning with `#`; these links render as non-interactive styled text. Navigation to headings is handled exclusively by the in-editor link menu.
- **Shared-device privacy leak: @ mention suggestions.** `priorCollaboratorsApi.ts` stored collaborators under a flat unscoped key (`freemannotes.priorCollaborators.v1`) that persisted across user sessions. A new user logging in on the same device saw the previous user's contacts in the @ dropdown — both from localStorage on cold load and from the module-level in-memory cache within the same tab session. Fix: the localStorage key is now user-scoped (`freemannotes.priorCollaborators.v1:<userId>`); `initPriorCollaboratorsForUser(userId)` is called on every login, and `clearPriorCollaboratorsCache()` + `invalidateWorkspaceMembersCache()` are called on logout. The old unscoped key is deleted on first login to clean up any existing leaked data.

## 1.6.4 - 2026-06-28

### Added
- **Inbox view and @mention activity system.** Collaborators can now @mention each other inside rich-text notes, checklist items, and quick reminders. Mentions create a real-time inbox card for the mentioned user with an "Accept & View" button when access needs to be granted, or a plain notification card when the user already has access. Assignments (mentions beside a checkbox item) surface as `assignment_created` cards. The inbox is accessible via the new Inbox navigation button with a live unread badge.
- **Bell notification panel shows inbox teaser.** When the badge count includes unread inbox items (mentions/assignments), clicking the bell now shows a compact "N unread mentions & assignments" card with an "Open Inbox" button, eliminating the confusing "No notifications right now" state when the badge is non-zero.
- **Draft-gate for @mentions.** Push notifications and inbox cards for @mentions are suppressed while a note is still unsaved (pending new). Mentions are only processed when the user saves the note; discarding a draft note produces no notifications at all.

### Fixed
- **"Accept & View" button missing on assignment cards.** Inbox cards for `assignment_created` activities (mentions beside a checkbox in a checklist note or rich-text task item) were not showing the "Accept & View" button. The `showAcceptBtn` guard now includes `assignment_created` alongside `mention`.
- **Double-counting in notification badge.** Mention invitations were being counted in both `pendingShareNotificationCount` (via `/api/note-shares/invitations`) and `inboxUnreadCount`. The invitations endpoint now excludes `source: 'mention'` invitations from `pendingCount` since these are surfaced through the inbox.
- **"Clear all" in inbox left stale badge count.** The previous `archiveAll` handler sent only the currently visible page of activities to `/api/inbox/archive`. If the user was on the "assigned" tab, unread items on "mentions" and "all" tabs were never archived, leaving the badge positive after clearing. A new `POST /api/inbox/archive-all` endpoint archives every non-archived activity for the user in a single transaction.
- **User A doesn't see real-time inbox updates when User B accepts a share.** After `emitNoteShareAcceptedActivity`, the server now also broadcasts `reason: 'inbox_updated'` via `onWorkspaceMetadataChanged` targeted at the inviter's userId, causing their client to re-fetch the inbox count without a page reload.
- **App icons and inbox icon fail offline.** The app header logo and inbox nav icon (`/icons/*.png`) were routed through `cacheFirstImage` in the service worker, which only checks `IMAGE_CACHE` and has no fallback to `APP_SHELL_CACHE` (where `precacheAppShell` stores them on install). These paths are now classified as static app-shell assets via `isStaticAssetRequest`, routing them through `staleWhileRevalidate` which falls back to `APP_SHELL_CACHE` — making them available offline even on first use after install.

## 1.6.3 - 2026-06-26

### Fixed
- **Drawing images disappear on reopen.** Images added via the Excalidraw image tool were blank when the drawing was closed and reopened. The `ExcalidrawBinding` (which calls `api.addFiles`) only runs when a WebSocket awareness object is available, so offline or slow-connect reopens never restored the files. A new `useEffect` on `[api, yAssets]` calls `api.addFiles` as soon as Excalidraw mounts, covering both the case where IDB has already applied its state and the async case where IDB loads after mount via a `yAssets` observer.
- **Android hyperlinks lose unsaved note data.** Tapping a hyperlink in an unsaved note editor while in Android standalone (PWA) mode navigated the WebView in-place (`target="_self"`), discarding all React state. Pressing back returned to a blank app. `getExternalLinkTarget()` now always returns `"_blank"`, opening links in a Chrome Custom Tab and leaving the PWA intact.
- **Grouping filter chip label blank.** Applying a group-by filter from the sidebar showed a blank chip at the top of the notes grid. `ScrollingScopeChipLabel` renders `chip.value` (scrolling part) and `chip.title` (static prefix), but the grouping chip was only setting `chip.label`. Added `title` and `value` fields to match the chip contract used by all other filter chips.
- **Background scroll through modal overlays on touch devices.** Touching the dim background area beside a modal (outside the modal box) scrolled the notes grid behind it. Added `touch-action: none` to the overlay element CSS for: `PreferencesModal` (main overlay and `subOverlay` covering User, Appearance, Note Management sub-sections), `SendInviteModal`, `MetadataModal` (shared by Manage Labels and Manage Collections), and `WorkspaceSwitcherModal`. `touch-action` is not inherited, so each modal's children retain their default scroll behaviour.
- **Cross-column drag reverts to original position (dead-zone no-op).** Dragging a note to a different column showed the correct insertion preview but snapped back on drop. When the destination's row-major index in `flattenColumns` matched the note's existing canonical position, `applyTierReorderToCanonicalVisible` produced an unchanged order and the Yjs write was skipped. Fixed with a cross-column swap fallback: when the post-drag flattened order equals the pre-drag canonical order but the note's column changed, the dragged note swaps with whichever note occupied that column slot before the drag.

## 1.6.2 - 2026-06-24

### Added
- **PWA session restore after page discard.** Android/iOS can silently kill the PWA process when it is backgrounded (`sessionStorage` is lost but `localStorage` survives). A new `src/core/sessionRestore.ts` utility writes the open note to `freemannotes.session-restore.v1` on every navigation change. After auth completes, a once-per-session effect re-opens the note if the stored workspace matches. Cleared on sign-out. Requires local test: open a note, background the app 5–10 min, return — note should restore instead of landing on the grid.
- **SW debug logging.** Service worker lifecycle events (install, activate, cache hits, update checks, navigation) are captured to `localStorage` and surfaced in Preferences → Developer Tools (10-tap dev mode). Buttons: enable/disable, copy log to clipboard, clear log. Documents PWA reload regressions without needing DevTools. See `CONTRIBUTING.md` for the full event reference.
- **i18n for developer tools UI strings.** All button labels and section heading in the PreferencesModal dev tools panel now use `t('prefs.devTools*')` keys instead of hardcoded English. Spanish translations added; fallback entries in `FALLBACK_MESSAGES`.

### Fixed
- **Label deletion leaves stale chips on notes.** Deleting a label only removed it from the registry and from the one note open in the labels modal. All other notes retained the chip visually. `handleDeleteLabel` now iterates every loaded note doc via `manager.peekDoc` after the registry delete and strips the label. A `useEffect` on `openDoc` performs lazy cleanup for docs that weren't in memory at delete time (pruning any IDs no longer present in the registry on note open). The first-click confirmation button now shows the affected note count from the workspace render snapshot.
- **Collection deletion leaves notes assigned to deleted collection.** Same root cause and fix as label deletion. `handleDeleteCollection` clears `collectionId` across all loaded docs; lazy cleanup prunes stale IDs on open. The `window.confirm` message now includes the note count: `Delete "{name}"? {count} note(s) in this collection will be unassigned.`
- **Label/collection duplication when moving notes to an offline workspace.** When the target workspace had never opened a WS session (e.g. created while offline), its labels/collections registry had no live doc and no DB row. The server created new Yjs `Y.Map` entries for each remapped label/collection. When the offline client later synced, Yjs's append-only `Y.Array` preserved both entries — duplicates. Fix: `loadWorkspaceDocRow` now returns `wasEmpty`. `ensureTargetLabelIdsForMove` and `ensureTargetCollectionIdForMove` accept `targetWasEmpty`; when true and the client supplied a `preferredTargetIdsBySourceId` entry, they use the preferred ID directly and skip writing new Yjs entries. The empty registry is also not persisted to DB, preventing a blank server snapshot from clobbering the client's offline state on sync.
- **Undo/redo re-opens the software keyboard on mobile.** The bottom-left FAB undo/redo buttons (visible only when the keyboard is dismissed) called `.chain().focus()`, which re-focused the editor and triggered the soft keyboard. Separate no-focus handler variants (`handleTextUndoNoFocus`, `handleTextRedoNoFocus`, `handleChecklistPrimaryUndoNoFocus`, `handleChecklistPrimaryRedoNoFocus`) now drive the FAB buttons. The TipTap toolbar undo/redo (visible inside the keyboard) continues to call `.focus()` unchanged.

## 1.6.1 - 2026-06-22

### Added
- **Sidebar reminders "All" section.** New `has-reminder` filter mode surfaces every note in the current workspace that has any reminder set, regardless of due date. Appears as the first item in the Reminders sidebar group.

### Changed
- **Masonry tail-balanced column layout.** Column slot allocation now starts from round-robin sizes then iteratively transfers one slot from the tallest column to the shortest (up to 4 passes, 150 px minimum imbalance threshold). Only the bottom rows of the tallest column participate — canonical note order and the `flattenColumns === renderedIds` invariant are both preserved. Addresses uneven columns introduced when canonical order was unified across device widths.

### Fixed
- **Notes grid scrolls during modal open/close on desktop.** When a modal (image upload, label, collection, move, collaborator) was opened while the grid was scrolled down, the grid visibly scrolled down then snapped back on modal close. `useBodyScrollLock` now applies `html/body overflow:hidden` via JS inline style guarded by `pointer:fine` media query; Chrome desktop preserves `window.scrollY` under `overflow:hidden` so the grid position is unchanged. Mobile is unaffected (touch-action only).
- **Preferences modal Back button was a bare `←` icon.** User and Appearance sub-sections referenced an undefined `iconButtonLeft` CSS class, rendering an unstyled arrow in the header. Replaced with a `← Back` text button in `.subFooter` at the bottom left of each sub-section, consistent with all other sections.
- **Preferences Notifications Back button hidden behind scroll.** On mobile, the Back button was inside the scrollable recent-deliveries area and unreachable without scrolling to the bottom. Back button now sits in a `position: sticky; bottom: 0` footer outside the scroll container. Recent delivery log capped to 4 entries on all screen sizes.
- **Checklist autocomplete ghost text overflows note card.** Long autocomplete suggestions expanded across multiple lines. Ghost text is now capped at 2 lines with `…` via `-webkit-line-clamp: 2`.
- **Android camera activity hides media handle.** Camera and file-picker transitions on Android cause a transient Visual Viewport shrink that `useKeyboardHeight` interprets as a software keyboard, collapsing the media sheet. `mobileKeyboardOpen` is now a `useMemo` that additionally requires focus to be inside the editor overlay and no image-upload modal to be open, filtering out the false-positive shrinks.
- **Bottom-dock Add Image button skips media sheet on mobile.** Tapping the dock's image button launched the upload modal without first opening the media sheet, causing the sheet to remain closed after the upload was confirmed. The handler now expands the media sheet before calling `onAddImage` so the sheet stays visible after upload.

## 1.6.0 - 2026-06-21

### Added
- **BubbleView `notesStable` flag.** `useBubbleNotes` now returns `{ notes, notesStable }`. The flag gates `stableFilteredNotes` updates and CSS transition enablement so no repacks or snaps occur while inactive workspaces are still streaming in from IDB.
- **BubbleView `layoutChangeKey`.** Encodes `${containerWidth}:${Math.round(effectiveZoom)}`; the disable `useLayoutEffect` fires on this key so zoom-slider drags and window resizes snap bubbles immediately, while score-driven repositioning keeps the slow organic transitions.

### Changed
- **BubbleView debounce raised 120 ms → 5 000 ms.** Score buckets change on ≥5-min granularity; the longer debounce batches rapid Yjs `updatedAt` writes during collaborative editing without losing any scoring signal.
- **BubbleView content/checklist Yjs observers removed.** `onContentChange` and `onChecklistChange` fired on every keystroke but don't affect scoring. Only `meta.observe` and `titleText.observe` are wired in `useBubbleNotes`.
- **BubbleView `cloudRef` / `hasMeasuredCloud` — ResizeObserver-only.** The synchronous pre-warm call no longer sets `hasMeasuredCloud=true`; only the ResizeObserver callback does, ensuring the browser has finalised layout before bubbles are positioned and transitions enabled.
- **BubbleView size-class gate for `stableFilteredNotes`.** `packedLayout` deps use `stableFilteredNotes` (updated only when `notesStable=true` and a size class changed) instead of raw `filteredNotes`, eliminating streaming repacks and minor-EMA micro-repositioning.
- **BubbleView CSS transitions slowed.** `.cloudItem` and `.bubble` width transitions changed from 640 ms cubic-bezier to 2 500 ms / 4 000 ms ease-in-out so score-driven drift is imperceptibly slow.
- **BubbleView two-`useLayoutEffect` pattern.** Disable effect reacts to `layoutChangeKey` only (not `notesStable`); enable effect requires both `hasMeasuredCloud` and `notesStable` and uses a `requestAnimationFrame` delay before enabling transitions.
- **BubbleView CSS overflow fix.** Removed `overflow-x: hidden; overflow-y: visible` from `.cloud` and `.container` — the CSS spec computes this pair as `overflow-y: auto`, creating a scroll container that clipped bubbles and showed spurious scrollbars.
- **Camera capture button in NoteImageUploadModal.** Replaced CSS-drawn button (nested spans + circle CSS) with `<img src="/icons/Capture.png" />`.
- **PreferencesModal X button closes instantly.** Root modal X now calls `onCloseDirect` (via `commitOverlaySnapshot('replace')`) instead of `history.back()`, fixing the extra back-navigation step.
- **PreferencesModal sub-section X closes entire modal.** Added `onCloseAll` prop; sub-section X now closes the whole modal rather than returning to the list.
- **PreferencesModal Back button moved to footer.** Back arrow relocated from top-left header to a `← Back` button in `.subFooter` at the bottom-left of each sub-section.
- **PreferencesModal About section icons.** Switched from PNG imports to static `/icons/` URL paths, fixing broken images in production builds.

### Fixed
- **Collaborators not appearing in sidebar after note move.** `handleMoveNote` success path now calls `bumpCollaborationRefreshToken()`, forcing the collaborator sidebar to reload for the moved note's new workspace location.
- **BubbleView bubbles flicker on every collaborative keystroke.** Content and checklist observers removed from `useBubbleNotes`; 5 s debounce batches remaining metadata changes.
- **BubbleView streaming-load jitter.** `stableFilteredNotes` stays frozen while `notesStable=false` so no partial repacks occur as individual workspaces load in parallel.
- **BubbleView snap-on-view-switch (bubble→list→bubble).** `hasMeasuredCloud` only set from ResizeObserver callback, not the synchronous pre-warm, so bubbles never position against a stale width before layout is final.

## 1.5.9 - 2026-06-20

### Fixed
- **List/strip view scroll jumps to top after drag-and-drop.** Two-part fix: (1) `dragColumns` in `NoteGrid` now uses `renderedIds` (which includes the pending committed order) instead of stale `visibleIds` when the drag preview clears, so row order does not revert at drop. (2) `NoteListView` keeps window virtualization enabled during drag — toggling it off remounted the full list, collapsed document height, and reset `window.scrollY`. Neighbor shift animations instead run via document-space flip on mounted rows (wider overscan during drag/drop settle).

## 1.5.8 - 2026-06-20

### Added
- **Bubble view float animation restored.** The `bubbleFloat` keyframe, per-bubble `--bv-float-duration` / `--bv-float-delay` CSS variables, and hover `animation-play-state: paused` were all intact; a stray `animation: none` added during virtualization work silenced them. Restored to `animation: bubbleFloat …`.

### Changed
- **Excalidraw editor defaults.** New drawings open with Nunito as the default text font, thin stroke width, architect sloppiness (0), and sharp edges. Existing drawings continue to restore their own saved `appState`.

### Fixed
- **Excalidraw drawing anchor lands at wrong position.** The `syncViewportOffsets` effect that keeps Excalidraw's `offsetTop`/`offsetLeft` in sync with the canvas element's actual viewport position was previously guarded on `usesMobileEditorLayout` only. On desktop, the offset stayed at 0, causing first-click anchors to appear at an incorrect scene position (often the screen center). Guard removed so the sync runs on all device types.
- **List view untitled notes show `(untitled)`.** Notes without a title now display the localised `(untitled)` label in both list and detailed-list views, matching note card and search behaviour.
- **List view drag ghost matches real note row.** Ghost icon, title, content, and 3-dot menu now exactly mirror the live row layout for all note types (text, checklist, drawing) in both list views.
- **Mobile FAB disappears after banner image change + sidebar open.** `NoteBannerPickerModal` now pushes a `__noteBannerPicker` history entry on mobile; `App.tsx` recognises it as a dismiss-layer state and corrects a stuck `isMobileSidebarOpen: true` condition that blocked the FAB.
- **"Move to workspace" modal allows background scroll.** `useBodyScrollLock` added to `MoveNoteModal` so the note grid no longer scrolls behind the modal on iOS and desktop.
- **Note banner warm-start pop-in / stale-removal.** A `noteBannerWarmCache` (localStorage) is written at every banner assignment and read by `createSnapshotDocFromWorkspaceRenderSnapshot`, ensuring the correct banner state is present on the first paint of a warm restart.
- **Cold-start drag animations work on first drag.** `cardPositionAnimationsReady` now bypasses startup gates whenever a drag is active, so neighbour cards animate on the very first drag after a cold boot.

## 1.5.7 - 2026-06-15

### Added
- **`noteCardDragMediaRetention` module.** Retains blob URLs for image/drawing card previews for the duration of a grid drag so cross-column remounts do not revoke URLs the markup ghost still references.
- **Collapsible heading section-boundary test.** `tests/collapsible-heading-boundaries.test.js` covers collapsible-only section ownership, nested collapse, and markdown-it `horizontalRule` ad blocks between headings.
- **i18n locale key rule for agents.** `.cursor/rules/i18n-locale-keys.mdc` (local only); workflow documented in `memory/i18n.md`.

### Changed
- **Drawings panel tab lists drawing name and relative created date** instead of generic “Drawing preview ready” / element-count copy.
- **Search results and filter chips use i18n for `Collection:` / `Label:` prefixes** (`search.collectionPrefix`, `search.labelPrefix`, `search.matchCollection`, `search.matchLabel`; en + es).

### Fixed
- **Cross-column note-card drag no longer drops media previews.** Blob URLs are retained during drag and revoked after drop-settle; `NoteCard` defers revoke when retention is active.
- **Drag-start flash on media/drawing cards.** Grid drag ghost uses a synchronous HTML markup snapshot only — not a live `NoteCard` and not `placeholderHiddenDragId` (that path duplicated the card in the grid).
- **Desktop search clear control restored.** × button clears the search bar and results again on desktop header and mobile search overlay.
- **Collaborator modal layout on open.** Removed syncing label that shifted layout; accordion manage sections stay mounted until access resolves (`showManageSections`); cached share links hydrate in `useLayoutEffect` before paint so link rows do not pop in one-by-one.
- **SendInviteModal prior collaborator suggestions on focus.** Identifier field shows the privacy-scoped suggestion list on focus, matching CollaboratorModal behavior.
- **Collapsible heading section boundaries.** Collapsed sections end at the next **collapsible** heading of the same or higher level — non-collapsible headings no longer break multi-H1 pasted markdown collapse.
- **Nested collapsed heading parent expand/collapse flash.** Section hidden state and collapsible heading decorations apply before parent opacity fades.
- **Markdown horizontal rules inside collapsed sections.** Sections containing `horizontalRule` nodes collapse instantly so `<hr>` atoms are not left visible mid-fade.
- **Collapsible heading toggle stomped by stale prefs echo.** A 3s recent-local-write guard preserves optimistic collapse toggles when debounced preferences API or websocket snapshots arrive stale.

## 1.5.6 - 2026-06-14

### Added
- **Collapsible rich-text heading polish for production use.** In-flow opacity fade animations for collapse/expand, Enter-to-write under collapsed headings with transient `Writing...` feedback, and scoped per-note collapse-pref subscriptions to avoid grid-wide re-renders.
- **Heading collapse debug tooling.** Enable via `localStorage.__headingCollapseDebug = '1'` and summarize with `window.__printHeadingCollapseDebugSummary()`.

### Changed
- **Warm PWA grid startup now honors cached pin order immediately.** `pickRenderedDisplayOrder()` bridges warm layout cache and live pin snapshots; workspace render snapshots persist user-scoped pin state; virtual columns remeasure when note order changes.

### Fixed
- **Collapsible heading expand/collapse animations.** Removed two-phase expand spacer that caused empty gaps and missing fades; decoration refresh is sequenced so opacity animations run reliably on PWA/production builds.
- **Collapsible heading chevron hit-testing.** Toggle hitbox is anchored to the chevron icon so the caret can be placed after the last heading character while coarse pointers keep a 44px target.
- **Collapsible heading summary UI.** Removed persistent `• N lines` / item counts beside headings; `Writing...` clears on note save/close and empty draft paragraphs are pruned.
- **Warm-load pinned notes missing from the top of the grid.** Pinned notes no longer pop in a beat after reopen when the layout cache already had the correct pin-tier order.

## 1.5.5 - 2026-06-13

### Added
- **Note pins are now per-user preferences synced across devices.** Pin state lives in `UserPreference.notePinsByDocId`, hydrates on login, and broadcasts through the existing user-preferences pipeline so each user’s pinned notes follow them without rewriting shared Yjs note order.
- **Quick reminder creation from the notes workspace.** A dedicated quick-reminder modal creates a text note and registers its reminder in one flow from the top actions row.
- **Collapsible rich-text headings in note editors.** Heading blocks can collapse and expand in text notes, with per-device collapse preferences synced through user preferences.
- **Centralized reminder lookup utilities.** Reminder state for cards, filters, and editors now flows through shared lookup helpers so doc/note IDs, local cache, pending offline mutations, and server refresh reconcile consistently.

### Changed
- **Pinning and grid drag now use a display-layer pin tier on top of canonical note order.** Yjs `noteOrder` stays manual/canonical; pinned notes sort to the top for display only, drag commits reorder within the active pin tier, and cross-tier neighbor shifts no longer mix pinned and unpinned cards during drag previews.
- **Card-grid reading order stays stable across viewport sizes.** Masonry columns are packed in round-robin reading order instead of height-greedy placement, so A→B→C→D order no longer reshuffles when column count or card heights change.
- **Cross-column drag hit-testing is hybrid again.** The first insertion into a foreign column follows pointer Y; after the dragged card adopts that column, row hit-tests use the same ghost-edge logic as native in-column drags.
- **Mobile/PWA checklist editors scroll through completed-row handles.** Non-draggable completed-item grip icons no longer block vertical page scroll along the left edge.
- **Touch note-card drags no longer lock root overflow.** Scroll suppression during touch drag uses `touch-action` and grid-level `preventDefault` instead of `overflow: hidden` on `html`/`body`, which was breaking the sticky scope chip when the page was scrolled.

### Fixed
- **Drawing note cards can be long-pressed to drag from the preview image.** The thumbnail no longer intercepts the grid’s coarse-pointer drag gesture.
- **Pin and unpin no longer flash thumbtack badges or shuffle columns multiple times.** Display-order updates sync on the same render pass, pin-tier settle gates no longer re-arm on pin toggles, and preference POST responses now include `notePinsByDocId` instead of wiping local pin state.
- **Reminder bell icons now clear on every device when a reminder is deleted.** Server reminder refresh no longer preserves stale local lookup entries for notes removed on another client.
- **Push reminder sync and notification deep links are more reliable.** Reminder state changes broadcast to connected clients, preference API responses include pin/reminder fields consistently, and installed/PWA flows handle notification navigation more predictably.

## 1.5.4 - 2026-06-06

### Added
- **Bubble-view mode switches now carry traceable layout diagnostics.** View-mode changes can stamp a transition trace ID through the bubble layout path so intermittent warm-switch or repack issues can be inspected without shipping one-off logging patches.

### Changed
- **Bubble view and reminder navigation now behave more intentionally across device sizes.** Bubble cards use steadier packed layouts without the idle float animation, collaborator counts are cached between renders, zoom/detail scaling is tuned more carefully across mobile and desktop widths, and the sidebar Reminders section now includes `Past Due`.
- **Note-card action chrome now adapts cleanly to the active input model.** Mobile note cards keep the persistent corner 3-dot entry point, desktop cards keep the footer-dock menu action, and desktop more-menus stay aligned with their source card while clamping fully inside the viewport.

### Fixed
- **Touch note-card dragging no longer freezes when crossing columns.** Coarse-pointer card drags now use the same pragmatic drag path as the working title/banner handle path, with steadier cross-column insertion cooldowns and cleanup so whole-card drags can move between columns without locking up.
- **Desktop/tablet editors and checklist controls are consistent again.** Fine-pointer editors now cover the full app shell, duplicate checklist save/close chrome is removed, checklist footer undo/redo stays wired after keyboard dismissal, and the shared autoscroll toolbar control renders correctly across draft and existing note/checklist editors.
- **Note-card and editor actions no longer lose or clip key controls.** The desktop dock regained its 3-dot action, desktop more-menus no longer open partly off-screen, and note-card menu spacing no longer cuts off preview rails while still keeping the open menu visually tied to its source note.

## 1.5.3 - 2026-06-04

### Changed
- **Mobile media sheets now use one anchored drag-following model across saved and draft editors.** Saved notes plus the draft text and checklist editors now share the same handle-anchored mobile media sheet behavior, note-color-driven media panel theming, and stable collapse/open transitions so the sheet tracks the dock instead of appearing as a separate overlay.
- **Shell branding and quick-create icons are separated cleanly again.** The header/splash app icon now uses its own stable branded asset path, while the mobile FAB keeps its dedicated theme-aware button artwork and the Appearance preference now labels the display controls simply as `Display`.

### Fixed
- **Saved-note and draft media-sheet regressions are resolved.** The checklist editor regained its missing Media header/handle, the sheet no longer starts below the dock or duplicates handles, dock chrome stays visible during collapse, and the drawings tab no longer shows the lingering linked-drawings placeholder copy.
- **Banner, icon, and drag-preview polish regressions are cleaned up.** The Select banner image modal now blocks background touch scrolling, the original app header/splash image renders reliably again, the FAB rotates correctly on open, and dragged note ghosts no longer shrink across grid, list, or strip views.
- **Light note-color control contrast is consistent again.** White and other light note colors now keep readable checklist controls and media drag handles with the intended dark contrast treatment.

## 1.5.2 - 2026-06-03

### Changed
- **List and detailed-list note rows now communicate note type more clearly.** Desktop list-like views use width-based column breakpoints so they resize more predictably, list rows use larger note-type icons, drawing notes now render a dedicated drawing icon, and detailed-list previews stay aligned directly beneath the title.
- **Bannered note cards now follow the selected card color more closely.** Explicit note colors drive a stronger shared banner/title tint treatment so colored cards read as one surface instead of fighting the banner's original hue.

### Fixed
- **Development startup and locale bundling are stable again.** The dev server now uses dedicated web/server helper scripts, locale JSON is bundled from `src/locales`, and the recent duplicate banner-preference import regression no longer breaks Vite startup.
- **Banner artwork now loads reliably in Linux/Docker production builds.** The banner asset set now follows one lowercase on-disk naming convention across both theme folders, the dark-theme typo in the travel list asset was corrected, and banner URL generation now normalizes stored filenames before resolving paths on case-sensitive filesystems.
- **Banner pickers now populate correctly in Docker and Unraid production runtimes.** The server banner-definition API no longer assumes the source `public/` tree exists inside the runtime image and now falls back to the built `dist/CardBanners/Dark` directory that production containers actually ship.
- **Grid/list banner presentation regressions are resolved.** Grid card banners now use the intended centered crop, banner-only cards keep a readable checkbox accent color, and mobile list views reserve enough bottom space for the last row to scroll clear of the floating action button.


## 1.5.1 - 2026-06-02

### Added
- **Note cards can now use banner artwork as a first-class visual surface.** Banner selection is available across the grid, editors, and card menus with dedicated card/list asset contracts, localized labeling, and a distinct banner-picker icon path.

### Changed
- **Banner presentation is now collaborative and workspace-live instead of device-local.** Banner selection moved into shared note metadata so editors and eligible collaborators see updates immediately across devices, while legacy per-user banner preferences remain as a fallback for older notes until they are explicitly touched.
- **Card, list, and detailed-list banner rendering now follow clearer appearance rules.** Users can choose whether titles render above or below banners, the default is now above, compact list views stay distraction-free without note chips, and drag previews follow the same reduced metadata treatment.
- **Bannered card visuals are now intentionally unified.** When a banner is present, title readability, banner tinting, and the displayed card surface now derive from the same transformed banner palette so the header, media, and body no longer fight each other when a note color is also selected.

### Fixed
- **Warm startup and offline-first note recovery are more reliable again.** Startup hydration, render snapshots, offline banner preload, and cached workspace restores now reopen previously loaded workspaces more consistently without dropping saved notes or waiting for a full live refresh.
- **Banner and collaborator interactions no longer regress during offline or cold-start sessions.** Collaborator pickers can surface immediately from cached state, banner selections hydrate earlier, and previously loaded shared workspaces reopen faster with steadier live note state.
- **Reminder clears no longer come back after reloads or reconnects.** Local reminder caches and pending reminder mutations now reconcile explicit clears correctly so stale reminders do not resurrect from cached or queued state.
- **Development startup applies the expected database migration path again.** The server/db init flow now uses the corrected migration path during local startup so `npm start` and related server boots do not silently miss recent schema changes.

## 1.5.0 - 2026-05-30

### Added
- **Workspace note moves now have a built-in trace workflow for live debugging.** Client and server move phases can be captured with `?moveDebug=1` and retrieved from `/api/debug/move-trace?traceId=...`, making collaborator/media follow-up failures much easier to diagnose without shipping one-off logging patches.

### Changed
- **Card banner artwork now ships as SVG assets instead of PNGs.** The banner set is lighter to bundle and better aligned with the rest of the app's vector-heavy offline asset pipeline.
- **Build and server diagnostics are more intentional by default.** Excalidraw font files are now served from `/fonts/*` in both dev and production builds, Prisma query logging is opt-in through `LOG_PRISMA_QUERIES=true`, and personal-workspace lookup now treats `PERSONAL` system workspaces as first-class user destinations.

### Fixed
- **Moving a note between workspaces now preserves the moved note's full working state more reliably.** The optimistic/local move path keeps docId-keyed image, link, collaborator, reminder, and note-order caches aligned with the new workspace, remaps collection and label IDs into the target workspace, and keeps attached drawing subdocuments on the same move path.
- **Interrupted note moves now resume safely instead of corrupting server state or failing with a false conflict.** The server move transaction now creates target document rows before repointing foreign-keyed child rows, reuses stale target note rows left behind by a partial move, and keeps collaborator/share/media rows consistent as the source rows are retired.
- **Shared-note follow-through after a move is steadier for both owners and collaborators.** Media and collaborator refreshes now carry move trace IDs, stale shared-placement aliases no longer resolve to invalid doc IDs, retained workspace members are materialized into direct share rows during a move, and transient post-move 403/404 or empty responses stop wiping richer migrated caches before the server catches up.
- **Startup and collaboration regressions uncovered during the move investigation are resolved.** Fresh login no longer trips the restored auth gate hook order, detached rich-text fragments no longer warn at startup, the drawing editor waits for Yjs awareness before binding collaboration, and note pin state resolves through the user-scoped pin preference store in note grids.

## 1.4.9 - 2026-05-25

### Changed
- **Shared With Me placements are now persisted in IndexedDB like the rest of the workspace shell.** The app now keeps shared note placements per user and workspace in a dedicated local store, hydrates them before network refresh, and reuses that cache in Bubble View so Shared With Me and its subfolders stay on the same offline-first footing as other workspaces.

### Fixed
- **Shared With Me notes no longer disappear when the app goes offline or reopens from local cache.** Placement refreshes now read through IndexedDB instead of falling back to an empty network result, so the Shared With Me workspace and its folders keep their visible notes while offline.
- **The About version badge now renders offline in installed builds.** The version icon is bundled like the other About artwork, so the About screen no longer falls back to a broken image placeholder when the app is offline.

## 1.4.8 - 2026-05-24

### Changed
- **Desktop list and detailed-list views now use responsive multi-column layouts with matching drag previews.** Non-grouped list-like views split into contiguous desktop columns, preserve cross-column neighbor shifting during drag, and the drag ghost now mirrors the real row badges, trailing ellipsis action, and strip preview truncation.
- **Chip overlays now open with cleaner production-safe motion and sizing.** Attachment and collaborator overlays clip their row reveals inside the card width, use a smoother wipe-in animation, and no longer force a wider shell than the originating chip row.

### Fixed
- **Returning from a list reorder to grid view now repacks masonry columns normally.** List/strip drag commits keep the new note order without leaking list-column anchor state into the masonry repacker, so grid mode no longer inherits long-short column imbalances after a reorder.
- **Mobile and installed-PWA text editing no longer drifts the viewport upward while deleting content.** Rich-text updates stop forcing selection visibility on every keystroke, which prevents repeated backspace from ratcheting the editor shell while the keyboard is open.
- **Offline and lazy-loaded production flows are more resilient.** Shared-with-me workspace placements can recover from cached sidebar state during startup, the drawing editor can fall back cleanly if its lazy chunk is unavailable on first open, and the service worker now falls back to precached app-shell assets and cached API/image responses more reliably when the network is unavailable.

## 1.4.7 - 2026-05-24

### Fixed
- **Attachment chips and media panels now stay in sync with live note state.** Note cards now surface attachment chips from current attachment totals instead of stale snapshot counts, and deleting an image from the media panel no longer leaves a ghost entry behind after a successful empty refresh.
- **Attachment drawing flows now reopen reliably from note cards and browsers.** Attached drawings use the overlay replacement path instead of a history race, and markdown task-item text on note cards once again opens the editor instead of being swallowed by the checkbox row.
- **Toolbar and media flows now behave consistently offline and on desktop.** Custom editor icons render without network dependence, the condensed toolbar keeps the scroll-to-bottom control, themed URL preview actions match the rest of the toolbar, and the desktop media sidebar stays open while the add-image modal is active.
- **Localization now reaches the remaining drawing and search surfaces.** The mobile create-drawing FAB, note-grid scope label, and Excalidraw chrome now respect the active app locale, including Spanish, without the localized undo/redo integration crash.
- **Mobile search dismissal is now history-safe on Android.** The mobile search overlay closes through the shared overlay-history path so the Android back button dismisses search without desynchronizing the header state.
- **The image upload modal's camera capability typing now compiles cleanly under TypeScript.** Zoom, torch, and focus-mode capability reads keep their extended camera-track typing, and the camera launch button uses the correct click handler signature.

## 1.4.6 - 2026-05-24

### Fixed
- **Cross-column drag-and-drop now feels identical to same-column reordering.** Destination columns respond to the live drag anchor (finger/pointer position) instead of the dragged card's rectangle, so notes with very different heights — such as expanded checklist cards — no longer cause missed or skipped insertion points during a cross-column drag.
- **Column entry is now driven by where the pointer actually is.** The dragged card stays in its source column until the pointer physically leaves it, then snaps to the destination column the moment the pointer enters it, with edge-proximity fallback when the pointer is in a gap. No more dead zones from center-distance column selection.
- **A small viewport-edge visibility bias prevents mostly-offscreen destination cards from stealing the insertion slot** near the top or bottom of the scroll container.

## 1.4.5 - 2026-05-15

### Fixed
- **Production startup now uses the pinned Prisma 5 CLI instead of falling back to `npx` at runtime.** Database initialization invokes the local Prisma package directly, and the `prisma` package now stays in production dependencies so `migrate deploy` still works after `npm prune --omit=dev`.

## 1.4.4 - 2026-05-15

### Fixed
- **Docker image builds no longer use a stale build cache to run a removed `npx prisma generate` step.** The Prisma CLI is now invoked directly from `node_modules/.bin` instead of via `npx`, preventing npm from downloading an incompatible newer version when the cache is warm. Build cache export is now `mode=min` to avoid caching intermediate layers that can replay outdated commands.

## 1.4.3 - 2026-05-15

### Fixed
- **Docker image builds now complete reliably regardless of cached layer state.** The Prisma client is generated before `npm prune` runs, so the local `prisma@5` CLI is always used instead of `npx` downloading the incompatible v7 release.

## 1.4.2 - 2026-05-15

### Changed
- **Collaborator chips now lead each note card's metadata row and keep avatar spacing visually even.** Single collaborators render as centered filter avatars, small groups use a centered rotating avatar stack, and larger groups keep the existing count chip behavior.
- **Checklist editor controls now behave more consistently across note and draft editors.** Mobile toolbar actions, checkbox interactions, and icon rendering now follow the same paths in both editor surfaces.

### Fixed
- **Checklist cards no longer stretch, shift, or leave inconsistent completed-section spacing as previews settle.** Card height budgeting and completed-item layout now stay stable across desktop, mobile browsers, and installed PWA sessions.
- **Warm relaunches and dense list layouts no longer show the recent note movement and scroll jitter regressions.** Startup hydration and list-view sizing now settle without the visible post-paint shuffle seen in recent builds.
- **Mobile checklist interactions no longer flicker the keyboard or show mismatched checkbox visuals.** Toggle, delete, undo/redo, toolbar icons, and note-card checkbox styling now stay aligned with the editor state.

## 1.4.0 - 2026-05-12

### Added
- **Drawing workflows are now first-class across the app.** Freeman Notes now ships a dedicated Excalidraw-based drawing editor with canvas background presets, warm-start thumbnail caching, and support for bundled or drop-in custom drawing libraries.
- **Share and invite flows now remember who you work with.** Collaborator and invite dialogs can suggest prior collaborators, including cached identity and avatar details for faster repeat sharing.

### Changed
- **Mobile and installed-PWA behavior now stays aligned with desktop more consistently.** External navigation, editor layout, docked actions, and attachment flows now follow the same interaction model across desktop, mobile browsers, and installed app sessions.
- **Drawing cards and drawing browsers now reopen faster and stay visually steadier.** Cached thumbnails, viewport-aware preview sizing, and drawing-specific rendering paths reduce first-frame placeholder flashes and keep drawing-heavy workspaces more stable.

### Fixed
- **Bubble and drawing-heavy note views no longer try to render the entire workspace at once.** View virtualization and viewport-scoped rendering reduce DOM churn, improve workspace switches, and keep bubble layouts steadier while notes stream in.
- **New drawings now use explicit Save and Cancel actions, while existing drawings keep Done.** This prevents accidental dismissals during first-save flows without changing the faster existing-note edit path.
- **Drawing ink contrast now updates immediately against the selected canvas background.** Auto-contrast defaults, live text editing, and selective recoloring of auto-ink elements now stay in sync before the user commits the element.
- **Drawing note-card previews now keep the full drawing visible across devices.** Warm relaunches recover cached previews sooner, and desktop/mobile cards no longer clip or mis-scale the rendered drawing thumbnail.

## 1.3.5 - 2026-05-05

### Changed
- **Shared-note workspace metadata now stays collaborator-scoped.** Shared placements now carry per-collaborator collection and label state through the API and client overlays, so each collaborator can organize a shared note without mutating the owner's canonical metadata.
- **Workspace note moves now preserve local note context across the optimistic move.** Local media, link, document, and collaborator caches now follow the moved doc id immediately, and moved notes remap collections and labels into the destination workspace instead of dropping that metadata.

### Fixed
- **Refreshing the app no longer reopens whichever modal or editor was last visible.** Overlay restore now strips transient UI state and returns to the current workspace view after a hard refresh.
- **Shared-note collaboration keeps working after the owner moves a note to another workspace.** Shared-note aliases now reopen against the remapped room id, and move flows update the destination registries and collaborator metadata consistently.
- **Checklist cards stay stable as collapsed and completed rows rebalance.** Checklist preview budgeting, completed-section sizing, and grid position layout now avoid the clipping and jumpiness seen in recent checklist cards.
- **Mobile and PWA image viewing is smoother.** The image viewer now clamps zoomed panning to image bounds, hands edge swipes off to previous or next navigation, and resolves the next image source immediately so first-pass swipes stop flashing the previous image.

## 1.3.4 - 2026-05-04

### Added
- **The Add Image camera modal now surfaces device zoom and rear-lens controls when the browser exposes them.** Camera capture can show offline-safe zoom controls and dedicated rear-lens chips, including ultrawide lenses when Android/WebView reports them as separate rear cameras.

### Changed
- **Filter chips and sidebar rows now preserve full names without forcing horizontal overflow.** Active scope chips use bounded marquee labels, sidebar collections compress deep ancestry into a readable second line, and workspace switcher rows wrap long workspace and owner names instead of clipping.
- **Checklist completion visuals are now consistent across cards and editors.** The shared rounded-square checkbox shell, larger checkmark glyph, and lighter strikethrough treatment now match between note cards and checklist editors.

### Fixed
- **List, detailed-list, and bubble views now avoid rendering the full note set at once.** Window virtualization and viewport culling reduce DOM work in list, strip, and bubble views, and workspace switches reset restored scroll state so virtualized layouts reopen from the correct viewport position.
- **Collection chips and deep collection trees stay readable on mobile and in dense sidebars.** Collection metadata overlays now wrap path segments cleanly, expanded branches auto-scroll into view, and deep indentation no longer pushes nested collection names off-screen.
- **Camera zoom changes no longer knock the live preview out of autofocus.** Zoom and torch updates now reapply focus-capable constraints together instead of overwriting the active camera track state during capture.

## 1.3.3 - 2026-05-04

### Added
- **Workspace render snapshots now seed the PWA shell before live docs hydrate.** Warm relaunches can restore note shells, preview rails, metadata chips, and per-view scroll positions from local snapshot state so desktop and installed-PWA sessions reopen with visible structure immediately.

### Changed
- **Note colors are now fully user-scoped preferences instead of collaborator-visible doc state.** Personal note color choices sync across a user's devices through the preferences API while legacy shared color metadata remains read-only fallback during migration.
- **The header view switcher now opens an explicit anchored icon row.** Desktop, mobile, and installed-PWA layouts now expose direct card, list, detailed list, and bubble view selection without cycling through modes.
- **Quick-create actions now show drawing placeholders alongside iconized note and checklist actions.** Desktop top actions and mobile FAB menus are aligned for the upcoming drawing flow without exposing an unfinished editor.

### Fixed
- **Reminder clears and updates now propagate across the same user's active clients more reliably.** Offline reminder mutations are retried until they flush, explicit clears stay represented as `null`, and workspace metadata events refresh reminder badges after cross-client changes.
- **Desktop refreshes no longer reopen the last edited note, and warm relaunches recover cleanly after backend restarts.** Overlay restore logic now avoids reopening editor overlays on fine-pointer devices, and offline-restored sessions keep probing until the server is reachable again.
- **Checklist cards stay visually stable when completed rows expand on desktop.** Masonry columns freeze after the first settle, completed rows remain in normal card flow, and desktop checkboxes match the editor's native control styling so cards no longer jump or clip their footer/link rails.

## 1.3.2 - 2026-05-03

### Changed
- **NoteGrid now virtualizes masonry columns independently instead of flattening the entire grid.** Each column keeps the DOM as the layout authority, card heights are refreshed from `ResizeObserver` updates, and drag sessions temporarily render full columns so drop previews stay accurate.
- **Docker publishing now follows semantic GHCR release rules automatically.** The GitHub Actions workflow publishes immutable `major.minor.patch`, `major.minor`, and `major` image tags from release tags, updates `latest` only from the highest release tag or `main`, and uses the repository `GITHUB_TOKEN` instead of a personal access token.

### Fixed
- **Warm relaunches and workspace switches no longer show note hydration behind the splash.** Startup and workspace readiness gates now rearm whenever the active workspace or view changes, and the splash only dismisses after the first stable viewport paint for the next grid.
- **Warm masonry restores no longer leave a small repack tail as note heights settle.** Visible card measurements now refresh incrementally from observed DOM height changes, which keeps cached layouts and collaborator chip placement steadier during startup.

## 1.3.0 - 2026-04-24

### Added
- **Checklist rows can now become count items across editors, cards, and shared views.** Checklist items support an optional numeric prefix, with toolbar actions to create, increment, decrement, and remove count rows, and the new count state now flows through note editors, note cards, public shares, workspace image search text, and checklist data bindings.

### Changed
- **Startup hydration now seeds the app shell from local cache before React finishes booting.** Device appearance, workspace list, note order, labels, collections, and reminder state are hydrated up front so workspace switches and app relaunches feel immediate instead of waiting on IndexedDB and network round-trips.
- **Masonry layout now reuses viewport-aware local layout snapshots.** NoteGrid persists per-device column slots, rects, and note-order hints so the first visible cards can render in stable positions sooner on warm launches.
- **Network-sensitive image loading now prefers lightweight previews on poor connections.** Image viewers, note media panels, and workspace galleries favor cached thumbnails and progressive previews sooner, while remote media requests and push endpoints now use explicit request timeouts.
- **Workspace pickers and sidebar rows now surface owner context more clearly.** Shared workspace rows display owner identity more consistently in the sidebar and switcher UI, while collaborator invites reject duplicate identifiers before making a server request.
- **Verified Vite builds now preserve nested build artifacts.** The shared Vite config keeps nested inject-manifest builds from emptying the outDir mid-build, matching the verified `dist-build-temp` publish flow.

### Fixed
- **Fresh and warm launches no longer hold the splash screen until every note finishes loading.** The grid now dismisses startup loading as soon as the viewport-visible cards are loaded, measured, and stable, while still guarding against empty-card flashes during the first WebSocket sync.
- **Server dev shutdowns no longer randomly exit with code 1 during reconnect-heavy sessions.** Graceful shutdown now terminates active WebSocket clients, closes lingering HTTP keep-alive connections, and logs uncaught synchronous exceptions instead of crashing silently.
- **Pasted rich text no longer squashes note-card previews.** Multi-block clipboard HTML now falls back to the normal line-aligned preview clamp when block-boundary clamping would collapse the card to a single short paragraph.
- **iOS Safari and iOS installed PWA launches no longer appear globally zoomed and cropped.** The app now applies locked viewport settings earlier for iOS Safari and stabilizes text autosizing so the shell opens at the correct scale.
- **Queued note-image previews survive the handoff to the real uploaded image more smoothly.** Successful uploads now promote the queued preview into the remote preview cache instead of dropping to a blank placeholder while metadata refresh catches up.
- **Image URL imports fail fast on invalid input instead of queueing unusable jobs.** The Add Image flow now validates `http://` and `https://` URLs before enqueueing them.

## 1.2.33 - 2026-04-20

### Fixed
- **Mobile sidebar close interactions are smooth again.** Closing the drawer from a drag no longer causes the panel to jump left and snap back under the finger before finishing the gesture.
- **Mobile sidebar reopen behavior is restored after tap-away close.** Dismissing the drawer by tapping outside it no longer leaves the FAB and sidebar state out of sync, and the sidebar button and edge-swipe opener work again on the next interaction.

## 1.2.32 - 2026-04-20

### Fixed
- **Docker image builds no longer fail during `npm ci` postinstall.** The build stage now copies `scripts/prisma-generate-if-needed.cjs` before `npm ci`, so the install-time Prisma generate hook exists when npm runs `postinstall` inside the container.

### Changed
- **Debug build artifact folders are no longer shipped in git.** The tracked `dist-notegrid-debug`, `dist-notegrid-quiescence`, `dist-runtime-debug`, and `dist-sidebar-swipe-fix` directories were removed from the repository so release commits only carry source and intentional assets.
- **Ignore and Docker context rules now exclude local debug build output.** `.gitignore` now ignores `dist-*`, and `.dockerignore` excludes `dist-*` and `.venv` so local troubleshooting outputs do not leak into future commits or Docker build contexts.

## 1.2.31 - 2026-04-20

### Fixed
- **Default production builds now publish to `dist` safely again.** `npm run build` now compiles into a temporary output directory, verifies the result contains a complete app shell, and only then swaps it into `dist`. This prevents partially written frontend assets from breaking `/` while the Node server and health checks still appear healthy.
- **Windows build publishing now survives file-lock rename failures.** The release build wrapper retries transient filesystem errors and falls back to copy-and-delete when Windows refuses a directory rename with `EPERM`/`EBUSY`, so the verified build still lands in `dist`.
- **Mobile sidebar edge-swipe open works immediately after a fresh login.** The open-gesture listener now stays mounted for the full mobile session and reads auth, grid, editor, selection, and sidebar state through live refs instead of stale closure state captured during initial app bootstrap.

### Changed
- **Deployment and install templates now match the current runtime configuration.** Docker Compose, `.env.example`, `.env.docker.example`, `DEPLOYMENT.md`, the README install sections, and the Unraid template were refreshed to document the current auth, notification, cleanup, Redis, and OCR variables, including the workspace-cleanup controls and release image tag references.

## 1.2.30 - 2026-04-19

### Fixed
- **Android standalone/offline note editor now reopens at the correct height after Add Image flows.** The fullscreen editor overlay could retain a latent scroll offset after nested modal transitions, which left the editor effectively shifted off-screen on the next open. The mobile editor shell now derives its height from the live Visual Viewport, and the fullscreen overlay aggressively resets its own scroll position during mount so reopen/dismiss cycles use the real visible viewport.

### Changed
- **Temporary Android editor tracing was removed after the fix was verified.** The one-off modal/scroll diagnostics added during investigation have been stripped back out so the production bundle only keeps the underlying viewport and overlay fix.

## 1.2.28 - 2026-04-16

### Fixed
- **Bubble view: score-driven size changes and repacking now animate slowly and naturally.** When a note's importance score increased (e.g. it was just edited, pinned, or given a reminder), the bubble previously snapped to its new size and position almost instantly (240 ms). The CSS transitions on `.cloudItem` have been lengthened to 640 ms (smooth ease-in-out) for size and 820 ms (gentle spring overshoot) for position — giving bubbles a physics-like quality where they gently inflate/deflate and drift to their new place rather than jumping.
- **Bubble view: bubbles now shrink smoothly instead of snapping.** The bubble's inner circle is sized via `width: min(100%, var(--bv-bubble-diameter))`. When the diameter CSS variable decreased, the `min()` resolved instantly (the px value became smaller than `100%`) while the container was still transitioning — producing an immediate visual shrink before the container caught up. A matching `width 640ms` transition has been added to `.bubble` so the inner circle tracks the container on both grow and shrink.
- **Bubble view: repacking after zoom-slider changes now feels fluid.** Because each new slider position starts a fresh 820 ms transition from the current interpolated position (rather than the old settled position), bubbles appear to drift through the cloud like they are suspended in liquid, rather than snapping to each new packing solution.
- **Bubble view: active workspace bubbles now appear instantly when switching to Bubble view.** Previously the component performed all workspace IDB loads (one 4-second timeout per inactive workspace) before calling `setNotes` once — meaning the cloud was blank until every workspace finished. Active workspace notes are now emitted immediately (they are already in memory), and each inactive workspace's notes are streamed into state as soon as that workspace's IDB load completes.
- **Bubble view: bubbles now enter with a natural staggered drift.** Entrance animations have been slowed (spring stiffness 180 / damping 18 vs. 260 / 22) and staggered by 28 ms per bubble in score-sorted order, so the most important bubbles appear first and smaller ones drift in behind them.
- **Concurrent offline edits to checklist items no longer concatenate.** When two users each deleted and retyped the full content of the same checklist item while offline, Yjs CRDT merged their character-level edits into one concatenated item (e.g. "breadCream"). The fix adds a ProseMirror `appendTransaction` plugin to `MobileSafeTaskItem` that detects "full-content replacement" transactions — any `ReplaceStep` whose range spans the entire text of an item's own paragraph — and converts the operation from a text-level edit into a node-level replacement: the original `Y.XmlElement` is tombstoned and a fresh element with a new UUID is inserted. On CRDT merge, both users' old element is tombstoned (agreement) and each new element has a distinct Yjs clock identity, so they coexist as two separate list items instead of being merged. This covers select-all-then-type, paste-over-selection, and the final backspace that empties the item.
- **Header connection scan line now reaches the full width before restarting.** The traveling highlight on the restored thin-line connection indicator now completes its sweep across the full line instead of cycling early.

## 1.2.27 - 2026-04-15

### Fixed
- **Note cards are now dynamic-height again (content-based, capped at the configured maximum).** The v1.2.26 `min-height` rule forced every card to fill the full configured height regardless of content length, making short notes appear with a large empty area and preventing cards from being shorter than the configured cap. The `min-height` has been removed; cards once again resize freely to their content with `max-height` as the upper bound only.
- **Changing the Note Card Height preference now correctly applies to all workspaces.** Whenever any preference slider was moved, `persistDevicePrefsLocally`'s `useCallback` captured all current pref-state values in its dep array. This propagated to `syncLocalDevicePrefsFromServer` getting a new function identity on every slider tick. Because `syncLocalDevicePrefsFromServer` was listed in the prefs-hydration `useEffect`'s dependencies, the entire effect re-fired on every slider movement — triggering a fresh `fetchUserPreferences` network call that returned the stale server value and raced to overwrite the in-flight local change. The stable-ref pattern (already used by `refreshActiveWorkspaceRef`) is now applied to both `syncLocalDevicePrefsFromServer` and `persistDevicePrefsLocally` in the prefs-hydration effect; the effect's dep array is reduced to true auth-state deps only (`authStatus`, `authUserId`, `deviceId`, `authOfflineMode`, `setLocale`), preventing spurious re-fires.
- **Changing the Note Card Height preference now correctly rebalances masonry columns.** When the max-card-height cap changed (e.g. the user moved the height slider in Preferences), previously-measured card heights cached in memory remained at the old cap value. The masonry column-distribution algorithm kept using those stale heights, so columns were unbalanced and did not reflect the new cap until a workspace switch or full page reload. NoteGrid now clears its in-memory height cache and triggers a fresh measurement pass whenever `maxCardHeightPx` changes, ensuring the masonry immediately rebalances at the correct heights.

## 1.2.26 - 2026-04-15

### Fixed
- **Note cards now appear at a consistent height in the grid.** Cards previously rendered at their natural content height (often very small for short notes) with no lower bound. A `min-height: var(--note-card-max-height)` rule was added to the card element so every card fills the configured height regardless of content length. This makes the Note Card Height setting visually effective for all workspaces and all note lengths.
- **Default card height and font scale are now device-aware for new devices.** On first login from a fresh device (detected by the absence of a saved card height in the server record), mobile devices (coarse-pointer) now default to 480 px card height, 75 % note-card font scale, and 80 % editor font scale; desktop devices default to 920 px and 100 % scales. The defaults are pushed to the server immediately so they persist across subsequent logins.
- **Minimum font scale lowered from 75 % to 60 %.** The Display Size slider in Settings now allows scaling down to 60 % to accommodate more display environments.
- **Collaborator modal avatars fall back to initials when the image fails to load.** All four avatar rows (invitee, current user, note owner, collaborators) now use a `MemberAvatar` component that tracks image-load errors and renders the letter-initial fallback when the image is unavailable (e.g. offline SW cache miss), replacing the broken-image browser icon.

### Fixed
- **Fresh-login skeleton cards no longer jump when WS content arrives.** On a first visit (empty IndexedDB) the docs-loaded check completed almost instantly because IDB sync resolves immediately for empty stores. The shimmer disappeared while the WS server was still delivering note content, causing card heights to shift as real data populated. `DocumentManager` now tracks a `registryWsSynced` flag that becomes `true` only after the notes-registry WebSocket room fires its first full sync. `NoteGrid` holds `allDocsLoaded = false` (keeping the shimmer up) until this flag is set, ensuring the grid measures real content heights before revealing cards.
- **Pending-invitation rows in the Collaborators modal now show the invitee's avatar.** The server `mapInvitation` function included the invitee's Prisma record in its DB select but did not expose the `id` field in the API response. Without `inviteeId` the client could not look up the cached avatar URL. `inviteeId` is now included in the server response, stored in the collaborator IDB cache, and used as a fallback in `CollaboratorModal` via `getCachedAvatarUrl` so avatars are shown even when the invitee profile image is not directly embedded in the snapshot.

### Fixed
- **Note card shimmer now suppresses correctly across PWA re-opens.** The seen-workspace registry was previously stored in `sessionStorage`, which iOS/Android clears when the app is terminated. It is now stored in `localStorage` so the "skip shimmer on warm IDB" logic works after every app relaunch, not just in-session page refreshes.
- **Pending sync icon no longer appears when editing online.** On every workspace switch DocumentManager discards WS providers but kept the per-doc `onAfterTransaction` listeners alive. Those stale closures held a reference to the destroyed WS provider whose `wsconnected` is `undefined` (falsy), so any subsequent edit triggered the 3-second debounce and showed a false pending-sync badge. `docCleanup` is now called alongside `wsCleanup` during workspace transitions so handlers are correctly removed and re-attached when the workspace is revisited.
- **Connection indicator no longer flashes "connecting" on every workspace switch.** The header icon transitions to the connecting state are debounced by 600 ms. Workspace switches that complete their WS reconnect faster than that (typical case) are invisible to the user.
- **Accepted personal-workspace shared notes appear in under 2 seconds instead of ~30.** After accepting a share into a personal workspace the WS provider for the new room connects immediately, but the server may not have committed collaborator permissions to its WS session store yet. A 1.5-second delayed `reconnectAllProviders` call now bridges that window, avoiding the full 30-second `resyncInterval` wait.
- **Collaborator avatar images are now cached by the service worker when first seen.** `updateAvatarCache` now fires a fire-and-forget `fetch` for each new same-origin avatar URL while online. The service worker intercepts the request and stores the image in `freemannotes-images-v2` so it is served from cache on the next offline session.

### Fixed
- **PWA re-open no longer re-shows shimmer/skeleton on warm cache.** `seenWorkspaceIdsRef` was never populated after the grid was ready, so `suppressShimmer` was always `false`. The ref is now initialised from `sessionStorage` on mount and written to `sessionStorage` in the `onReady` callback, so workspaces already loaded this session skip the skeleton animation entirely.
- **Sync-pending icon no longer flashes during brief reconnects.** When the app returns to the foreground it force-reconnects WebSocket providers; any in-flight edits briefly set a pending-sync badge even when connectivity was never actually lost. A 3-second debounce in `DocumentManager` now delays the badge until the reconnect window has passed, eliminating the false flash on fast reconnects.
- **Accepting a note share into a personal workspace now works.** `handleAcceptedSharedPlacement` previously returned early for `target === 'personal'` acceptances, silently dropping them. It now switches to the target workspace (if needed) and refreshes placements so accepted notes appear in the grid. `visibleSharedPlacements` also now returns active-workspace placements for non-Shared-With-Me workspaces instead of always returning an empty array.
- **Inviter avatars survive offline sessions.** User profile-image URLs returned by the note-share API are now stored in a lightweight `localStorage` cache (`freemannotes.userAvatarCache.v1`). The Notifications modal falls back to the cached URL when the live URL is unavailable, keeping inviter chips from going blank after connectivity is lost.

### Fixed
- **Bubble-click on Shared With Me notes now opens the editor correctly.** The v1.2.21 fix for preventing shared notes from appearing in all workspaces used an incorrect approach (splitting state) that broke placement lookups when clicking a bubble. The fix is now applied in `visibleSharedPlacements` instead: it returns an empty array when the active workspace is not Shared With Me, so NoteGrid never injects shared alias IDs into other workspace grids. `sharedPlacements` continues to hold all placements from every SHARED_WITH_ME workspace, keeping bubble-click lookups, cross-workspace modal resolution, and room-alias registration fully intact.

## 1.2.21 - 2026-04-15

### Fixed
- **Shared With Me notes no longer appear in every workspace.** Fetching placements from all SHARED_WITH_ME workspaces (needed for bubble-view alias resolution) was inadvertently storing them all in state, causing the NoteGrid to display shared notes regardless of which workspace was active. Extra-workspace placements are now kept in a ref used only for room-alias registration, while `sharedPlacements` state (which drives the NoteGrid) is limited to the active workspace only.
- **Clearing failed link-preview notifications now persists and updates the badge.** Clicking "Clear notifications" when only URL-preview failures were present would remove the rows on screen but leave the bell badge count unchanged, and the items would re-appear on the next metadata refresh. Dismissed failure IDs are now saved to `localStorage` and filtered out on every subsequent `refreshNoteShareState` call, and the badge count is decremented immediately on dismiss.

## 1.2.20 - 2026-04-14

### Changed
- **Condensed toolbar toggle buttons are now icons.** The pill-shaped text labels ("Headings", "Lists", "Insert", "Layout", "Copy") in the condensed toolbar have been replaced with compact icon buttons for a cleaner, more space-efficient layout. A new Formatting group (B icon) exposes Bold, Italic, Underline, Strikethrough, Link, Highlight, and Scroll-to-bottom — all of which were previously always visible in the primary row. Sub-toolbar action buttons are slightly larger in condensed mode than in the full toolbar for better tap targets on mobile.

## 1.2.19 - 2026-04-14

### Fixed
- **"Clear notifications" button now works when only link-preview failures are present.** The button was permanently disabled in the Notifications modal when the sole items were failed URL metadata fetches. Failed link-preview notifications are now included in `canClearNotifications` and a new `onClearFailedLinks` callback clears them from app state when the user dismisses.
- **Bubble view now opens notes from non-active "Shared with me" workspaces.** Clicking a bubble belonging to a workspace other than the currently active one failed silently for shared-note placements because their Yjs room IDs were never registered. `refreshNoteShareState` now fetches placements for every SHARED_WITH_ME workspace (not just the active one) and registers them all in `setExternalRoomAliases` so the cross-workspace note modal resolves the correct room and sub-folder notes work too.

### Changed
- **Debug overlay and debug console removed from production build.** The "DBG" pill, event-log overlay, and per-component mount/unmount tracking that were added during Android camera lifecycle debugging have been stripped from `App.tsx`, `NoteEditor.tsx`, and `NoteImageUploadModal.tsx`. No user-visible or functional behaviour changes.
- **Verbose WebSocket connection logging removed from server.** The `[ws-debug] open` and `[ws-debug] close` lines that logged every Yjs WebSocket connection to the npm console have been removed from `server.js`.

## 1.2.18 - 2026-04-12

### Added
- **Editors now support strikethrough and a per-device condensed toolbar mode.** Rich-text note editors expose strikethrough in the full, minimal, and selection bubble toolbars, and Preferences now lets each device choose between the full toolbar and a grouped condensed toolbar.

### Changed
- **Checklist cards and note previews fit their space more cleanly.** Checklist cards now budget space for active and completed items without inner-scroll traps, recently completed rows stay visible first, and text cards only apply a fade/clamp when the body actually overflows.

### Fixed
- **Bubble and cross-workspace ghost notes are filtered out before they render.** Bubble loading and cross-workspace hydration now treat empty title/body/checklist docs as stale ghost entries and close missing-note views cleanly instead of showing broken placeholders.
- **Android/PWA back navigation now restores the notes view from Images and Trash.** Special mobile sidebar views now reuse the sidebar history entry they were opened from, so Back returns directly to the previous notes list instead of reopening the sidebar or exiting the app.

### Changed
- **Photo-upload modal behavior was hardened for Android and mobile testing.** The Add Image flow now includes stricter interaction shielding around Android camera return events, stronger on-submit filename checks across queued and stored note images, keyboard-dismiss timing adjustments when renaming before submit, and a fixed footer action area so the Add Photo button stays visible while the file list scrolls.

## 1.2.17 - 2026-04-11

### Added
- **Admins can now issue direct registration invites from preferences.** Global admins get a dedicated Send Invite flow that emails a one-time registration link for a specific address, even when public registration is disabled.

### Changed
- **Authenticated startup applies the user theme earlier.** Theme bootstrap now prefers the signed-in user's cached or freshly fetched preference before workspace activation so the first authenticated note load uses the right appearance sooner.

### Fixed
- **Cold-login note grids no longer reshuffle as card data hydrates.** Placeholder cards, first-pass masonry packing, and ready-state handoff now share the same fallback height model so a clean browser login stays visually stable.
- **Auth sessions are now more resilient across normal long-term use.** Successful `/api/auth/me` checks now refresh finite session cookies as a rolling window instead of letting them expire on a fixed schedule, and the service worker no longer caches auth probes or any API responses marked `Cache-Control: no-store`, which removes the stale-auth state that previously forced some users to clear browser cache.

## 1.2.16 - 2026-04-11

### Added
- **Shared workspace owner context is easier to inspect.** Foreign workspace avatar chips now open an inline owner card in the sidebar, and the workspace cache/API path carries the owner metadata needed to keep that identity visible across refreshes.
- **Cross-workspace bubble notes now expose the same note actions when permissions allow.** The standalone bubble note modal can now hand off collaborator, reminder, attachment, collection, and label actions without switching the active workspace, while still respecting read-only roles.

### Changed
- **Highlighting and mobile checklist editing are more usable.** The rich-text toolbar now includes a default highlight swatch plus lime/cyan/rose options, unstyled highlights render consistently in note previews, and checklist checkbox undo/redo moved from the mobile keyboard toolbar into contextual controls beside the media handle.
- **Android standalone PWA chrome is more consistent with the active theme.** Installed Android launches now apply the stricter viewport and theme-color handling needed to keep the background and system navigation bar aligned with the app surface.

### Fixed
- **Mobile chip dropdowns now stay centered on left-column note cards.** Collaborator, metadata, and attachment menus clamp to the same 4px edge margin used by the mobile grid instead of drifting right.
- **Opening note collaborators no longer scrolls the notes grid to the top.** Root scroll locking now captures and restores the real document scroll position when modals open and close.
- **Mobile note-card more menus no longer leak taps through or dismiss awkwardly.** The sheet now keeps the opening gesture guarded, adds an explicit close button, and supports a dedicated swipe-down handle without activating the note underneath.

## 1.2.15 - 2026-04-10

### Added
- **Personal workspace is now canonically identified in the database.** A new `PERSONAL` value in the `WorkspaceSystemKind` enum replaces the legacy UUID-name pattern heuristic. New registrations receive `systemKind = PERSONAL` at creation; existing workspaces are backfilled by migration. The name-pattern fallback is retained for any rows that predate the migration.
- **Workspace list now includes owner name and profile image for foreign workspaces.** Shared workspaces carry `ownerName` and `ownerProfileImage` in the API response so the UI can distinguish identically-named workspaces from different owners.
- **Note-share invitations now carry the invitee's profile image.** The collaborator and invitation payload includes the invitee avatar alongside the inviter's, enabling richer accept/decline UI.
- **Granular note-card interaction preferences.** Three new per-device toggles — `noteCardCheckboxInteractions`, `noteCardLinkInteractions`, `noteCardCompletedInteractions` — allow fine-grained control of checkbox tapping, link opening, and completed-item collapse on note cards. The existing `noteCardClickOpens` flag continues to act as a master toggle that sets all three at once.

### Fixed
- **VIEWER-role collaborators can now sync Yjs rooms and use the editor.** The Yjs WebSocket handler was closing connections on `messageYjsSyncStep2` for read-only clients. `SyncStep2` is the client's *required handshake reply* to the server's own `SyncStep1`; closing on it created an infinite reconnect loop that caused a perpetually flashing connection indicator, a locked/unusable editor, and continuous Prisma query spam on the server.
- **Collaborator-sync effect no longer runs on every Yjs connection state change.** `NoteGrid`'s collaborator-sync `useEffect` depended on a `new Set(...)` that gets a fresh object reference on every `DocumentManager` snapshot emission, even when the pending note IDs are unchanged. The effect dependency is now a stable `string` signature, eliminating spurious database queries whenever the WebSocket transitions between `connecting`, `synced`, and `offline` states.
- **Note-share revoke now notifies all source-workspace members.** `onWorkspaceMetadataChanged` on collaborator revoke now includes all workspace members of the note's source workspace so open collaborator lists on any connected device converge immediately.
- **Gateway errors (502/503/504) during sharing operations queue offline rather than failing.** Share link generation (`ensureNoteShareLink`, `ensureWorkspaceShareLink`), workspace invite removal (`removeWorkspaceMemberAccess`), workspace creation, and collaborator role/revoke operations all catch 502/503/504 responses and fall back to the offline queue.
- **`WS metadata debounce` prevents Prisma query bursts on note-share events.** Note-share WS events now debounce both `refreshNoteShareState` and `bumpCollaborationRefreshToken` together (300 ms), so a burst of N events produces one pair of calls instead of N × DB queries.

### Infrastructure
- **PostgreSQL enum split migration pattern.** `ALTER TYPE ... ADD VALUE` commits the new enum value only when its enclosing transaction ends; any `UPDATE` referencing the new value in the same transaction fails with error 55P04. The `20260412000000_personal_workspace_kind` migration now contains only the `ALTER TYPE`; the backfill `UPDATE` runs in a separate migration `20260412000001_personal_workspace_kind_backfill`.

### Debug instrumentation (development only)
- Server logs `[ws-debug] open/close room=… readOnly=… code=…` for every Yjs WS connection, making rapid reconnect loops immediately visible in the server terminal.
- Browser console emits `[collab-debug]` when `bumpCollaborationRefreshToken` is called more than 3 times in 2 seconds.
- Browser console emits `[ws-meta-debug]` when more than 10 metadata WS messages arrive in 2 seconds.
- Browser console emits `[collab-sync]` listing which dep changed each time the NoteGrid collaborator-sync effect fires.

## 1.2.14 - 2026-04-09

### Added
- **Workspace bubble colors are now user-customizable and theme-aware.** Each workspace can be assigned a personal semantic bubble color that persists per user, syncs across sessions/devices, and resolves into light/medium/dark theme-adaptive shades instead of storing raw hex values.
- **Cross-workspace bubble opens now mount a dedicated standalone editor.** Tapping a bubble from another workspace opens that note directly without switching the active workspace, using a dedicated modal/editor hydration path that reuses the background-cached Yjs room.

### Changed
- **Bubble importance is now expressed with a much wider size and placement range.** Bubble sizing uses a broader diameter ladder, a stronger freshness curve, a tighter title-growth cap, and rank-aware vertical packing so important notes float higher while stale notes sink lower more consistently across desktop and mobile.
- **Bubble zoom now scales by viewport.** Desktop retains the existing 100% zoom feel, while mobile/PWA uses a flatter upper zoom curve so the same slider value remains practical on narrow screens.

### Fixed
- **Workspace bubble color overrides now survive refresh and sync live to other sessions.** Preference fetch/save responses now always include bubble color overrides, discrete picker actions flush immediately, and a user-preferences WebSocket metadata event triggers other sessions to refresh without overwriting local changes.
- **Bubble workspace color picking is more reliable and usable.** Picker outside-click handling no longer swallows swatch clicks, the palette offers a broader mix of light/medium/dark families, and the portal-based picker stays within view without button-like borders or clipping.
- **Cross-workspace note opening no longer flashes a malformed nested mobile layout.** The modal now delays its loading state slightly and only shows a lightweight loading shell while IndexedDB/websocket hydration settles, avoiding the transient fullscreen editor glitch.

## 1.2.13 - 2026-04-09

### Fixed
- **Workspace deletion no longer leaves the connection indicator permanently red.** On fast or local connections the server's metadata WebSocket echo could arrive and be processed by the browser *before* the `fetch` Promise for the DELETE request resolved, causing `clearActiveWorkspaceState` to disable WebSocket sync before the new workspace's providers were set up. The fix registers a suppression guard *before* the HTTP request is sent (`onBeforeWorkspaceDelete`), adds a synchronous workspace-ID check via `DocumentManager.getActiveWorkspaceId()` as a reliable fallback, and explicitly re-enables WebSocket sync in `handleWorkspaceDeleted` as a recovery safety valve.

## 1.2.12 - 2026-04-09

### Added
- **Multi-color text highlighting in the rich-text editor.** The TipTap toolbar now includes a highlight button that opens an 8-color swatch picker (yellow, green, blue, pink, purple, orange, teal, red). Colors are stored as CSS variables and adapt to the active theme.
- **Emoji picker in the rich-text toolbar.** A quick-access emoji grid (48 emojis, no external dependency) is available directly in the TipTap toolbar for all rich-text note types.
- **Checklist undo / redo.** Both the new-note (`ChecklistEditor`) and existing-note (`NoteEditor`) checklist editors now support undoing and redoing check/uncheck actions via toolbar buttons and the standard `Ctrl+Z` / `Ctrl+Shift+Z` keyboard shortcuts.

### Fixed
- **Highlight colors now render in note card and list views.** The rich-text preview renderer in note cards and the detailed list view now handles the `highlight` mark and renders the stored color, matching the in-editor appearance.
- **Checklist undo/redo toolbar buttons are properly sized and theme-adaptive.** The undo/redo icons use the same CSS `mask-image` technique as other toolbar icons so they scale correctly at 16 × 16 and inherit the current theme color.

### Added
- **Sidebar label management is now available outside note editing.** The sidebar now includes a dedicated `Manage labels...` entry, and the labels modal can switch into a standalone management mode with focused side-pane editing on mobile.
- **Pending note-share invites can now be cancelled.** Owners can revoke queued or server-persisted note-share invitations, and share notification panels now refresh live when invitation metadata changes elsewhere.

### Changed
- **Backend route edits now hot-reload in development.** The dev server script now runs `node --watch server.js` after database init so server-side fixes no longer require manual restarts.
- **Reminder and test delivery now resolve against the originating device.** Test notifications and reminder fallbacks now target the current device registration before deciding whether email should be used.

### Fixed
- **Mobile and installed iOS PWA scrolling is more stable.** Mobile sidebar scrolling, short-editor auto-scroll, and the installed iOS quick-create FAB now stay anchored without pull-down drift.
- **Notification branding and fallback diagnostics are clearer.** Push notifications now use dedicated app icon/badge assets, and failed email fallback attempts now surface the SMTP transport error in the test UI.
- **Metadata management layouts no longer overflow on narrow screens.** Collection tree rows and the labels management layout now stay within the modal width while keeping edit controls accessible.

## 1.2.10 - 2026-04-07

### Added
- **Collection and label management is now inline and self-validating.** The Add to collection, Manage collections, and Add labels flows now support in-place create and rename actions, duplicate-name validation, and richer label color selection with preset swatches plus a custom picker.

### Changed
- **Note actions and metadata chips are more consistent across cards and editors.** Collection chip menus now show themed folder rows with compact nested paths, attachment counts use the note accent color, note editors expose pin and bulk checklist actions in the more menu, and link/image additions surface the same brief confirmation feedback in editors and attachment browsers.
- **Collection trees and label tools are more usable on mobile.** Collection modals now use their full height, support horizontal scrolling for deeply nested trees, and the custom label color picker opens in its own anchored container instead of shifting modal content.

### Fixed
- **Chip overlays no longer leak taps through to note cards.** Collaborator, metadata, and attachment chip menus now suppress ghost taps and close cleanly without opening the underlying note on touch devices.
- **Android back now closes the Add to collection modal.** Coarse-pointer devices push a temporary history entry so the system back gesture dismisses the modal first.
- **Checklist and list interactions settle more cleanly after touch edits.** Expanded completed-item sections can hand scrolling back to the page, list and strip reorders use a shorter settle window, and touch reorder cleanup now avoids accidental post-drop note opens.

## 1.2.0 - 2026-04-06

### Added
- **First beta release baseline.** Freeman Notes now ships with a release-aligned Docker Compose stack, refreshed deployment docs, and an updated Unraid template so the packaged deployment story matches the current runtime behavior.
- **Richer reminder delivery.** Reminder notifications and reminder emails now include note context, workspace context, and preview text, with a browser-viewable reminder email preview added under `scripts/reminder-email-preview.html`.

### Changed
- **Reminder delivery now prefers clearer branding and fallback behavior.** User-facing reminder/test delivery now uses `Freeman Notes` branding, app-icon-based notification assets, and clearer notification-state copy when email fallback is active.
- **Sidebar organization is simpler.** Reminder shortcuts, quick filters, grouping, and sort controls now have scoped clear actions, cleaner labels, and grouped rendering parity across card, list, strip, image-gallery, and bubble-derived reminder views.
- **Editor title fields and quick-create flows are more resilient.** New-note editing now preserves metadata-aware drafts more reliably, uses autosizing title fields, and keeps checklist keyboard navigation/focus behavior consistent across editor surfaces.

### Fixed
- **Auto notification mode now falls back to email when push is unavailable or unregistered.** Server-side policy checks and client messaging now agree on when SMTP should be used instead of silently dropping reminder delivery.
- **Reminder-driven filtering now uses the server reminder source of truth.** Note grid, image gallery, bubble view, and reminder modals now resolve reminder timestamps through synced reminder state instead of relying on stale local metadata.
- **Desktop sidebar scrolling is less intrusive.** Desktop sidebars now use the same minimal scrollbar treatment already used in note-card completed-item lists, while mobile keeps its existing hidden-scrollbar behavior.

## 1.1.43 - 2026-04-06

### Changed
- **Note-card chip dropdowns now share one card-aligned layout.** Label, collaborator, collection, and attachment chip menus now use the full note-card width and stay horizontally centered on the card instead of drifting based on whichever chip button opened them.

### Fixed
- **Chip dropdown vertical placement now follows the chip row.** The first pass at card-width anchoring used the full card rect for vertical placement as well, which made menus appear below the whole card or too far above it. The anchor logic now keeps card-based width/centering but uses the actual chip trigger for the above/below flip so menus open directly under the chip row when there is room and directly above it when there is not.
- **Chip dropdown animations are smoother and more consistent.** All note-card chip menus now use a lighter, slightly faster stagger with reduced bounce and no height-jitter between rows.

## 1.1.42 - 2026-04-06

### Added
- **New notes are hidden from the grid and Bubble View until saved.** Creating a note/checklist no longer flashes an empty card in the note grid or an extra bubble in Bubble View. The note only appears after the editor is closed with content — cancelling an empty note leaves the UI completely unchanged.
- **Cancel always shows an X on new notes.** The editor close button now always displays a discard icon (✕) while composing a brand-new note, regardless of whether any content has been typed. Previously the button could flip to a save-checkmark in Bubble View, incorrectly suggesting the note would be saved.

### Fixed
- **403 errors no longer fire when opening the editor from Bubble View.** Creating a note while in Bubble View previously triggered immediate API calls for media, documents, links, and share collaborators on a note that hadn't synced to the server yet. The draft note ID is now registered before any async IDB/network work begins, so NoteGrid and BubbleView filter it out and attachment chips are never mounted during the creation window.
- **Bubble View widths are now measured correctly on first render and after resize.** The previous `useEffect([], [])` ResizeObserver registration was a no-op when notes weren't yet loaded (the cloud div wasn't mounted). Replaced with a callback ref that attaches the ResizeObserver the moment the container appears in the DOM. The initial width estimate also correctly omits the sidebar on narrow/mobile viewports.

## 1.1.41 - 2026-04-05

### Changed
- **Rich-text nesting controls now work consistently across toolbar, keyboard, and mobile editors.** The full editor toolbar now exposes nest/outdent actions beside blockquote, mobile and PWA editor toolbars surface the same controls when list or quote nesting is active, and `Tab` / `Shift+Tab` follow the same structured nesting rules.
- **Android standalone chrome now picks up the app theme earlier and more reliably.** Theme bootstrap now runs before React mounts, the root element background is synced alongside `body`, and the generated PWA manifest defaults to the app background instead of a white fallback.

### Fixed
- **The mobile User Management Reset Password button now fits without changing button width.** The label now wraps as a controlled two-line button on small screens with slightly smaller control text.
- **iOS PWA quick-create controls now respect safe areas and blur the full app.** The FAB and its action stack now offset against safe-area insets, and the quick-create backdrop sits above the full shell so opening it blurs the entire viewport.

## 1.1.40 - 2026-04-05

### Changed
- **Checklist completion behavior is now shared across note cards and editors.** Parent/child checklist completion rules, including ghost parent rows in completed sections, now use a shared hierarchy helper so note cards, the checklist editor, and the full note editor stay in sync.
- **Admin user usage totals now span all owned workspaces.** User Management now reports database, document/file, and image usage across every live workspace owned by the user instead of only the earliest workspace.

### Fixed
- **Checklist editors now match note-card parent/child completion UX.** Toggling a parent cascades to its children, and unchecking a child correctly reopens a completed parent in both checklist editing surfaces.
- **Mobile checklist alignment survives note-card view changes.** Checklist rows now remeasure line wrapping when the card or viewport layout changes, preventing checkbox/text drift after switching views.
- **Card masonry layout no longer remeasures while hidden or in list-style views.** Hidden card grids now freeze their resolved columns, and list/strip layouts no longer overwrite the masonry height cache used by card view.
- **User Management modal layout and scroll behavior were tightened.** The modal now locks background scrolling, shows clearer usage categories, and uses a more compact control layout on desktop and mobile.
- **List and detailed-list label metadata no longer duplicates label text.** List-style note rows now keep only the single label summary badge instead of repeating label names inline.

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
