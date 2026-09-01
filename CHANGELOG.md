# Changelog

Every notable change to this project, logged here in more or less chronological order. Some of these fixes we're proud of. Some of them are here because we broke something first and then had to go fix it, and honesty seemed better than pretending it never happened.

## Unreleased

## 1.9.1 - 2026-08-31

A round of user-reported bugs, tackled root-cause-first instead of batched. Most of it landed clean. One thread of it — note card height/layout — pulled on a loose end and the loose end turned out to be attached to the whole sweater; see Known Issues below.

### Fixed
- **Rapidly tapping inbox cards could pop a false "no longer have access to this workspace" dialog, or stack up enough redundant navigation history to fall through to the app's own exit guard.** Inbox cards had no re-entrancy guard, and workspace activation checked a stale value instead of a call-sequence token — a second tap could switch workspaces out from under a still-in-flight note open from the first. Both are now guarded the same way an existing, similar race was fixed a few releases back.
- **Swiping from the left edge to navigate images in the viewer could open the sidebar underneath it, invisibly, until you closed the viewer.** The sidebar's edge-swipe gesture had no idea a full-screen overlay was on top of it.
- **Bubble View wouldn't open notes by tapping their bubble unless the active workspace was Personal**, self-healing the moment you switched workspaces again. Bubble click-routing was reading a note's workspace off a layout snapshot that lags the real active workspace during another workspace's multi-second background load — Personal is always already settled by the time you can click, everything else wasn't.
- **A newly-accepted collaborator didn't show up in the Collaborators modal's suggestions (or the @ mention list) until a full app restart.** The suggestions cache is a once-per-session singleton; accepting a share now invalidates it immediately, from every accept path.
- **A workspace created and edited entirely offline, then switched away from before reconnecting, never got its link previews synced — permanently, not just until the next reconnect.** The bootstrap logic that reconciles other local workspaces on reconnect only ran when the active workspace itself needed switching; a workspace that matched the server's on reconnect skipped it entirely, so that workspace's server-side record was simply never created.
- **Reminders: marking one complete from the note editor didn't clear the inbox card or the bell badge until you happened to open and close a few other notes, and the overdue chip could show with no corresponding inbox card or notification anywhere.** Two separate, non-communicating pieces of state were driving the bell/inbox vs. the editor chip. Unified them so completing a reminder from any surface updates all of them together, and split the chip's "is this actually due" signal from the bell's "acknowledged" state — clearing a notification no longer silently resolves the reminder, only actually completing or rescheduling it does.
- **Dragging a checklist item could make the whole list jump and send other items sliding to the wrong spot mid-drag**, specifically when scrolled down into a mix of active and completed items. The completed section used to fully unmount during a drag to keep auto-scroll from wandering into it (see 1.9.0) — removing that much content out from under a scrolled position forced the browser to snap the scroll position back to fit, which is the jump, and desynced the drag library's own animations for the rest of the gesture. It's hidden in place now (`visibility: hidden`) instead of removed, so the scroll container's height never changes and there's nothing to snap.
- **Checklist cards with a banner image visibly shrank when switching Card view → List view → Card view, and a card with a URL preview could clip the preview at the bottom of the card.** Checklist cards estimate their own chrome height before measuring the real DOM so they know how many items to draw; that estimate assumed a plain 39px header regardless of whether a banner made the real one 2-3x taller, so every fresh mount over-drew and then visibly corrected down.
- **The 3-dot overflow menu's reserved space below a URL preview (so it doesn't sit on top of the preview) has done nothing on any touch device since the release that added it (1.5.4).** A later CSS rule in the same file, same specificity, same selector, quietly zeroed the padding back out every time — a plain source-order shadow, invisible until someone went looking for it.

### Known Issues
- **The 3-dot menu fix above overshot**: it's no longer centered against the completed-items row on checklist cards without a preview, and text/drawing cards now reserve more space above it than needed. Being fixed as a follow-up.
- **Some checklist cards still render their completed-items dropdown or their checkboxes in a beat late on a cold app open or page refresh.**
- **A broader "note cards render taller than they should, then shrink" effect on cold start**, seen across card types, not just checklists — tied to how card heights get cached and replayed before a note's real content has loaded.
- These turned out to be threads of the same underlying tangle rather than independent bugs. The note grid's height/layout system is getting a proper ground-up audit next, instead of another round of one-off patches on top of each other.

## 1.9.0 - 2026-08-26

The big one this cycle is checklists — recency ordering, a progress bar, a real completion animation, and a new "get this out of my way" shortcut — plus a full pass on Bubble View, which turned out to have more wrong with it than just "the slider's broken."

### Added
- **Completed checklist items now sort most-recently-completed-first instead of always showing original list order.** Check things off in any order and the completed section reads like a timeline of what you just finished, not a frozen copy of the active list. Checking a parent (which cascades to its children) keeps the whole cascaded group reading top-to-bottom instead of backwards — stamping each item's timestamp in the order it got processed handed the parent the *oldest* stamp in the group and the last child the *newest*, so a most-recent-first sort surfaced the whole thing upside down. Also found and fixed the actual reason this looked broken in the live editor specifically: the code syncing Yjs into the interactive editor's live state was never reading the `completedAt` field off the document at all, so the sort had nothing to sort by no matter how correct the sorting logic itself was.
- **A checklist progress bar** — "N of X completed" plus an animated fill — sitting quietly above the title. The fill doesn't just resize: checking an item fires an accent orb from the start of the bar that drags the fill along behind it; unchecking fires an opposing grey orb from the far end that shoves the fill back the other way, like two sides fighting over the same space. Either way it finishes with the same double-expanding-ring pulse as the mobile FAB's long-press haptic feedback — deliberately, since that's already everyone's favorite animation in this app and it deserved a second home.
- **Checking or unchecking an item plays an actual animation now** instead of just teleporting into its new section: a strikethrough sweeps across the text while a soft two-layer glow blooms outward from the whole row, then the item slides into place. 1.8.8 shipped a first attempt at this that, on paper, worked completely correctly — right keyframes, right timing, nothing wrong with the code — and was still totally invisible to an actual human looking at the screen. Took a few more passes (a checkbox-anchored ring that read as too small and isolated, a full-row *border* that read as "the row grew a static outline" rather than a pulse, an `animation` shorthand silently resetting `animation-fill-mode` back to its default and killing the lead-in) before landing on the row-wide glow bloom that's shipping now. Also sped it up: the pulse used to wait for the strikethrough to finish before it even started, adding an extra beat before the item actually moved — the two now play at the same time, and the whole hold-before-relocating window dropped from 560ms to 300ms.
- **"Get this out of my way" — swipe a checklist item right to send it to the bottom of the list, left to bring it back to the top.** Long grocery lists were the original complaint: skipping an item you can't find yet meant dragging it across dozens of rows and then scrolling back to find your place. On desktop, hovering a row reveals the same two actions as up/down arrow buttons next to the existing delete button, with tooltips. Both platforms reuse the exact reorder logic drag-and-drop already had — a parent still carries its children along with it, a child landing at the very top still becomes top-level — same behavior as if you'd dragged it there by hand, just instant. Unlike drag-and-drop, this also pushes an undo entry, since a swipe is a lot easier to fire by accident than a deliberate drag.

### Fixed
- **Bubble View could duplicate a note into two overlapping bubbles**, most visibly right after tapping one. A leftover merge step from before shared notes became first-class `noteOrder` members (1.8.6) was still separately re-adding them on top of notes the normal note-order walk had already resolved — the same note, counted twice. Removed the leftover double-bookkeeping instead of papering over the symptom.
- **The Bubble View zoom slider snapped bubbles straight to their new size instead of growing into it, and never responded to touch on iOS at all.** Every zoom step was forcing the same instant-snap transition normally reserved for score changes, so dragging the slider looked like a jump-cut instead of a slide. Zoom now rides the same slow, organic transition as everything else. The iOS slider — `<input type="range">` and WebKit quietly disagreeing about who owns the drag gesture, so it just never moved — got replaced with a custom pointer-driven slider that actually works on touch.
- **Bubbles reshuffled their stacking order on every zoom step, and small bubbles could nest inside large ones** instead of finding their own space. Packing order now sorts by score before growth is applied instead of after, so ordering stays stable as bubbles resize; the vertical depth curve was retuned so smaller bubbles can reach real depth in the layout instead of capping out early and getting swallowed by their neighbors.
- **A note shared directly into a workspace other than the one you currently had open never showed up as a bubble for that other workspace**, even though opening that workspace directly worked fine. Every other (inactive) workspace's note list was resolved as if each entry were a real note id — but since 1.8.6, a directly-shared note shows up in a workspace's own note order as a `shared-placement:<uuid>` reference instead, and blindly guessing an IndexedDB room name from that reference points at a room nothing was ever written to. Those references are now recognized and resolved through the real placement data instead.
- **A shared note's title and content (not just its collaborator/label chips) could take a beat to actually show up on a cold app open**, in a normal personal workspace with some accepted shares mixed in. The chip-flash version of this got fixed a release or two ago, but the piece of state actually driving a shared note's whole card — not just its metadata chips — still started blank on every mount and only caught up once a network fetch resolved. Same underlying disease, a more visible symptom, deliberately left alone the first time since the reported bug back then was the chip, not the card. Warm-seeded from cache now, same as its sibling state.
- **The mobile editor's floating undo/redo buttons crept into the text area, and the media dock had a dead gap of blank space above it that visibly cut off the note's own text.** Both were CSS sizing bugs, not layout logic bugs: a scoped custom property that wasn't actually reaching the rule reading it, and a flex `gap` still reserving space for something the layout no longer had.
- **The checklist checkbox (and its drag handle) drifted out of alignment with the text next to it in the completed section and the read-only note viewer** — but not in the normal active/editable section, which made it a genuinely confusing report at first. The draggable handle is a real `<button>`, and this app's global button style reset gives every button asymmetric padding that the completed section's plain, non-draggable `<div>`-based handle never inherited — same CSS class, two different effective boxes depending on which element happened to host it. Matched the div's padding to the button's rather than the other way around; an earlier attempt at fixing it "at the root" by stripping the button's own padding instead just moved the misalignment onto the previously-correct active rows.

## 1.8.9 - 2026-08-23

Quick follow-up. Font scaling and one more offline-first gap, both found by actually testing the sliders and the throttle instead of assuming they worked.

### Fixed
- **Checklist checkboxes (and the drag handle next to them) drifted away from the text at any font scale that wasn't close to 100%.** The formula deciding their vertical offset computed the text's line-box from an unscaled `1em` that never once multiplied in the font-scale preference — it just happened to sit close enough to correct right around the default size that nobody noticed, which is exactly why "80-90% looks fine" was the reported range: that's just "close to 100%," not an actual safe zone. Drag the slider to 60% or 150% and the assumed line-box and the real rendered one diverge enough that the checkbox visibly floats above or below the text instead of sitting next to it. Fixed at the root instead of adding more special-case offsets on top of a wrong number.
- **The collapsible-heading dropdown arrow was a flat 20px icon that did not care in the slightest what font size was in play** — same size on h1 as h6, same size at 60% scale as 150%. Switched it to `em` units so it inherits the heading's own already-correctly-scaled font-size instead of ignoring it, which also makes it proportionally right across heading levels for the first time, not just across the font-size slider.
- **Throttle your connection and the Images gallery loaded like garbage instead of instantly** — going properly offline was already fast (cached previews kick in immediately), but a merely slow, "technically online" connection sat there waiting on a real network fetch every time, the exact same class of bug this whole offline-first pass keeps finding. Turned out the existing poor-connection detection only trusts the browser's Network Information API, and that API's thresholds are tuned for something close to dial-up — ordinary DevTools throttling doesn't reliably cross them, so the app kept thinking the connection was fine the entire time it very much was not. Every network image load now races against a timeout (short for thumbnails, longer for the full-size viewer) and falls back to the cached preview if it loses, and reports the slow load so every other image in the gallery benefits immediately instead of each one individually rediscovering the same bad connection one timeout at a time.

## 1.8.8 - 2026-08-23

Smaller than 1.8.7 on paper, but two of these took multiple genuine attempts before they actually worked, and one "bug" turned out to be four separate bugs wearing the same trenchcoat. Testing this hard keeps paying for itself.

### Added
- **Checking or unchecking a checklist item finally does something other than teleport it into the completed section like it got raptured.** Checking now sweeps a strikethrough left-to-right across the text, pulses once the sweep finishes, then animates the item sliding into its new section; unchecking plays the same sequence backwards. Works identically whether you're editing an existing checklist note or composing a brand-new one — those are two entirely separate implementations of "a checklist" in this codebase for reasons that made sense to somebody once, and both needed the same treatment, twice the work for one feature.

### Fixed
- **Dragging an unchecked checklist item near the bottom of the screen auto-scrolled the (permanently undroppable) completed section into view for absolutely no reason, and dropping there just snapped the item back and made you lose your place.** This is attempt number three. The first two — a reactive scroll-position clamp, then a "smarter" sensor-level pointer clamp — were both written and both reverted in the same night about a month ago. The reactive clamp fought the drag library's own auto-scroll loop and oscillated like a broken metronome. The pointer clamp technically worked but froze the drag ghost dead at the boundary while your actual finger kept moving past it, which just feels broken, not "blocked." This time we stopped trying to out-clever a black-box drag library's internal pointer tracking and just removed the hazard instead: the completed section's item list unrenders for the duration of any active-item drag, so there's nothing left to scroll into or hover over. Can't lose a race against a library's internal state over something that no longer exists.
- **The completion pulse for the animation above was firing exactly as designed and doing nothing visible whatsoever.** Checked the compiled CSS — keyframe name matched its own reference, no conflicting rules, animation genuinely playing on schedule — it was just a 16%-opacity tint and a 1.03x scale, completely lost underneath a strikethrough sweep and an item flying across the list. Bumped it to 34% plus a glowing ring so it reads as an actual pulse instead of a rounding error nobody could see.
- **"Shared With Me" subfolders could flash the wrong folder's notes on refresh, or just silently dump you back at the root folder for no visible reason, and it took finding four separate pieces of state all starting blank on every page load to fully explain it.** `sharedPlacements`, `sharedPlacementsHydrated`, `activeWorkspaceSystemKind`, and `activeSharedFolder` all started null/empty/false on mount and only became correct after an async round trip finished — any single one of them still being wrong on the very first render was enough to reproduce some flavor of this bug, which is exactly why it took four separate fixes before it actually stopped happening. All four now seed synchronously from the same local caches that already made other state (like the sidebar workspace list) correct instantly on a warm reload. Also turned up a genuinely separate bug during the same investigation: switching shared folders persisted the change to the server behind a ~1-second debounce that nothing ever explicitly flushed, so refreshing shortly after switching — a completely ordinary thing to do — could lose the pending write entirely and silently revert you to whatever folder the server had on file before you touched anything.
- **"Clear notifications" on the share-invitation bell only ever wrote to localStorage. Never touched the server. Not once.** Clear your browser cache, or log in from a different device, and every notification you already cleared comes back from the dead like nothing happened — because as far as the server knew, nothing had. Added actual server-side persistence for dismissed invitation IDs, mirroring the pattern that was already implemented correctly for dismissed failed-link notifications right next to it, which somehow nobody thought to copy when this feature got built.
- **A dev-only console warning was flooding the log with false positives on every shared note, on basically every re-render that touched one**, which was actively getting in the way of debugging something completely unrelated. The guard checking for orphaned `noteOrder` entries never got updated for 1.8.6's "shared notes are first-class `noteOrder` members" change, where a `shared-placement:<uuid>` alias is *supposed* to live in `noteOrder` with no matching entry in `notesList`. It was dutifully flagging every single shared note as broken, all the time, forever. It is not broken. Excluded on purpose now.
- Offline-first cold-start hardening: a fresh login on a new device that goes offline before hydration finishes now degrades to a clear "hasn't synced yet" message instead of quietly showing an empty Shared With Me workspace forever; a device auto-warms every Shared-With-Me workspace's placements in the background on login instead of only the active one; a stale login-timeout gap in the post-login `/api/auth/me` re-fetch and the avatar upload got the same `fetchWithTimeout` treatment as the rest of the auth flow; and "Authentication failed" no longer lies to you when the real problem was a timeout, not a rejected password.
- **`DocumentManager.preloadWorkspaceFromServer` only ever read a workspace's `notesList` array — which for a Shared-With-Me workspace is *always empty by design*, since shared notes only ever live in `noteOrder`.** So the background preload that's supposed to make every workspace usable offline was silently preloading nothing for the one workspace type that actually needed it, and Shared With Me stayed a blank grid offline no matter how long you waited. Now reads both arrays and resolves shared-placement aliases through the real room-alias map instead of guessing a room name that was never going to exist.
- Closed a folder/permission leak where a shared note could render inside the wrong folder (or a folder you shouldn't have been able to see it in) before its real placement data had loaded.
- Continued the offline-first fetch-timeout audit from 1.8.7 into roughly ten more files that never got the memo the first time around — note banners, note documents, note links, move/trash, prior-collaborator lookups, the sync outbox, workspace invites, the admin user-management modal, the public share landing page, and the workspace switcher. Same fix everywhere, because it's the same bug everywhere: plain `fetch()` on a "technically online" mobile connection can hang forever instead of erroring out, so every one of them got wrapped in the same hard-timeout helper as everything else.

## 1.8.7 - 2026-08-17

This one's a monster, and honestly a good chunk of it is us finding and fixing things that were only ever exposed by testing this hard in the first place. No regrets — better to find them now.

### Added
- **A build-verification system**, because "did the thing I just built actually get deployed" turned out to be a real, recurring question this cycle. A random 4-character tag is generated once per Vite process start, shown in Preferences → About next to the version number, and logged unconditionally as the very first thing the app does on boot (both browser console and, for the dev server, the terminal). `package.json`'s version alone couldn't answer "is this actually running" since it barely changes between iterations — this can. Matters most on an installed PWA, where a stale service worker can silently keep serving old code without anything on screen looking wrong.

### Changed
- **Dev now proxies `/yjs` WebSocket traffic to the real backend, same as production**, instead of handling it with a separate, simpler stand-in that ran inside the Vite process. See the "shared notes permanently broken in dev only" entry below for why — this wasn't a style preference, it was restoring an actual correctness guarantee (if it works in dev, it'll work in prod).
- Sidebar collaborator avatars are bigger (18px → 28px) and their names get a marquee scroll if they're too long to fit — they were hard to actually make out at the old size, and long names just ran off the edge before.
- The debug logger (`server/debugLogger.js`) now writes through a persistent stream with a 2MB rotation cap instead of reopening and appending to the log file on every single event. Found out the hard way that `fs.appendFileSync` against a file that's grown to several MB runs roughly 100x slower per write than against a fresh one (almost certainly antivirus scanning it on every write) — enough on its own to blow a 5-second database transaction timeout and make a perfectly healthy app look catastrophically, alarmingly broken for a good chunk of an evening. Turned on a diagnostic tool to go find a bug and the tool became the bug. No actual app regression was involved in that scare at all — just a badly-behaved logger we'd been happily running for weeks without ever letting the file grow big enough to notice.

### Fixed
- **A stale `vite.config.js` had been silently shadowing every edit to `vite.config.ts` for months, and it was infuriating to finally track down.** Vite picks `.js` over `.ts` when both exist, and this repo had both — the JS one frozen since release 1.5.5, long before the config moved to TypeScript, and never actually removed. Every change anyone made to `vite.config.ts` since then — including work everyone believed had shipped — was dead on arrival. Months of that. Found via `vite.resolveConfig()` returning the `.js` path directly, with absolutely nothing in the console to hint at it; a silent no-op is about the worst, most bullshit failure mode a config change can have. Fixed by renaming the stale file to `vite.config.legacy.js` (kept for reference, not deleted, so we remember what bit us) so Vite falls through to the real config.
- **Shared notes were permanently broken in local dev — forever-empty skeleton cards, not a loading flash.** Dev's Yjs WebSocket handling ran in a separate Node process from the one holding the actual database persistence layer, and never registered which workspace a room belonged to before opening it. Since the persistence layer's PostgreSQL read is workspace-scoped, a room whose workspace was never registered just silently loaded as empty — invisible for your own notes (their workspace gets inferred some other way), permanently broken for a note someone else shared into your workspace, since nothing else ever supplies that mapping. It also skipped auth and workspace-membership checks entirely. This was a deliberate tradeoff from earlier work, not an oversight — the separate handling was built specifically to quiet some noisy disconnect logging during mobile testing — but it traded away correctness to do it, which wasn't a fair trade. Dev now proxies to the real handler instead (see Changed, above).
- **Shared notes could vanish from the grid entirely while offline, then reappear once back online.** The reconciliation logic that keeps a workspace's shared-note references up to date treated a failed or timed-out network request identically to a real "you have zero shares" response — `navigator.onLine` alone can't tell those apart, since it can still read `true` during a dropped connection, a captive portal, or plain DNS failure. A false-empty result was trusted as ground truth and pruned every shared note from the workspace. Now tracks whether the fetch actually succeeded and refuses to prune (or corrupt the offline cache) on any cycle where it didn't.
- **Assigning a label or collection to a note shared with you, while offline, looked like it worked and then silently reverted once you reconnected.** The offline queue for this edit was only guaranteed to replay via PWA Background Sync, which iOS Safari and some desktop browsers don't support — and two other reconnect paths (the browser's `online` event, workspace-metadata WebSocket reconnect) fetched fresh server state without flushing that queue first, so stale pre-edit data could win the race and clobber the edit before it ever replayed. Now flushed from inside the single shared reconciliation function itself, so every caller benefits, not just the one background-sync path that happened to remember.
- **Two overlapping reconciliation calls for the same workspace could resolve out of order and silently overwrite good data with bad**, most visibly as two specific shared notes permanently stuck as empty skeleton cards — verified their underlying data and server responses were completely correct the whole time; the problem was purely a stale, superseded call's incomplete result winning the race against a newer, correct one. Fixed with a monotonic call-sequence token, so a superseded call can no longer write state, cache, or note-order data no matter how the network responses happen to land.
- **Note card chips (collaborators, labels, collections, attachments) on a shared note would flash empty and then pop back in on every refresh or reconnect** — three separate, stacked bugs in the same area, all boiling down to the persisted render-snapshot system (used to avoid exactly this kind of flash) not accounting for shared notes at all. It read a shared note's label/collection data straight from the note's own document instead of the placement row where that data actually lives (always empty, not just briefly stale), and never persisted the routing information the attachment chip needs to render at all, so that chip didn't even attempt to show until a slower async fetch caught up. List view had the same root problem through a different path — it had no fallback at all for a note whose live data hadn't loaded yet, silently rendering nothing, which visually looked like shared notes sorting to the bottom of the list until they popped in. All follow the same fix now: prefer live data, fall back to the last-known snapshot, never regress to empty on a transient gap — matching how collaborator count and attachment counts already correctly behaved before any of this was touched.
- **The collapsible rich-text heading chevron drifted off its heading on wrapped (multi-line) titles**, and its clickable area didn't line up with where the icon actually was, especially on mobile. Rebuilt the hit-testing to anchor off the icon's own geometry instead of a fixed pixel guess, and fixed a scrollbar that would briefly flash during the collapse/expand animation on multi-line headings.
- **Leaving a note shared with you didn't remove it from the grid promptly on a slow or degraded connection** — button worked, note stuck around anyway until a later refresh. And if you left a note from inside its own editor on mobile, the editor stayed open on a note you'd just left. Both fixed; leaving now updates the grid and closes the editor immediately regardless of connection quality.
- **Having your access to a note revoked while you had it open just yanked it out from under you with zero explanation** — abrupt enough to feel like data loss even though nothing was lost. Now shows a blocking overlay explaining what happened before closing, instead of tearing down instantly and silently.
- Four permission bugs specific to a drawing shared with you as **view-only**: trash was still available in the more-menu (the only correct way to leave a note is the collaborator modal, same as everywhere else); the collaborator icon was incorrectly greyed out, blocking you from even opening the modal to leave; the canvas background color was still editable; and a shared drawing didn't center its content in the viewport on open on mobile.
- The Preferences → Appearance → Display setting **"Banner Title Position" is now labeled "Note Title Position"** — while in there, discovered this string (and its two option labels) had never actually been added to the real English or Spanish translation files, only to the in-code fallback dictionary, meaning Spanish-language users were always seeing English text here regardless of their language setting. Fixed properly in both locale files, not just patched in the fallback.

### Changed
- **Shared notes accepted into a workspace are now genuinely part of that workspace's note order, not a separate group bolted on top of it.** 1.8.5 shipped a version of "accepted shared notes appear at the front" that was really a client-side illusion — a real note you own could get bumped down by them, but a shared note could never get bumped down by anything, drag-and-drop on it didn't persist, and refreshing the page was a coin flip. Turns out none of that was actually necessary: `noteOrder` — the same Yjs array that already drives position, drag-drop, and cross-device sync for your own notes — can just as easily hold a reference entry (`shared-placement:<uuid>`, the same id format already used elsewhere) alongside real note ids. So that's what it does now. A newly accepted share lands at the front exactly like a note you just created, and from that point on it *is* one, as far as the grid's concerned: draggable, reorderable, synced in real time across your own devices, no asterisk. Ownership of a note's content stays with whoever shared it — only where it lives in *your* workspace changed hands.
- **The dev-only "reset canonical note order" debug tool is gone.** It rebuilt `noteOrder` from scratch assuming every entry was a real, locally-owned note — an assumption the change above makes false, and the tool would've happily nuked every shared-note reference in your grid. Wasn't going to be needed going forward anyway.

### Fixed
- **Accepting a share while offline through the Inbox tab's own "Confirm & Open" button didn't work — and didn't tell you it didn't work either.** The notification-bell dropdown already had a full offline story (queue the accept, replay it once you're back online), but the Inbox tab's own accept button was a completely separate code path that never got the memo: offline, it just silently ate the click. Now uses the identical queue-and-replay logic as the bell, so accepting from either surface behaves the same regardless of connection.
- **The collapsible-heading chevron drifted off-center and could dangle below wrapped heading titles like it had given up on the layout entirely.** It was pinned to 50% of the heading block's *total* height, which only means anything when the heading is exactly one line — the moment a title wrapped to two (which its own reserved padding made more likely than it needed to be), the icon landed somewhere in the gap between the lines instead of centered on either one. The whole positioning approach is different now: the chevron is a floated element that genuinely rides along with the last line of wrapped text, wherever that ends up, with a per-heading-level vertical offset so it's pixel-centered at any font size instead of centered on a number that only made sense for the single-line case. Also gave it some actual breathing room from the title text instead of crowding it.
- **Collapsing a heading with a lot of content underneath could launch your scroll position toward the bottom of the note.** Once the content under a heading vanishes, the browser has nowhere left to keep you where you were, so it just clamps and you land somewhere you didn't ask to be. Fixed with the same trick already shipped for the note grid's checklist completed-items collapse: reserve the space that's about to disappear *before* it disappears, so nothing gets forcibly clamped, then quietly let that reservation shrink away as you scroll past it. The previous attempt at this (measure before/after, nudge scrollTop once) never actually worked for the animated collapse path — the fade doesn't remove the layout height until it finishes, by which point the one-shot correction had already fired against the wrong numbers — so it's gone now, replaced with a strategy that's actually correct instead of just plausible.
- **Chased down a report of the Android PWA status bar going black with invisible icons on light themes.** Added a live `color-scheme` meta tag alongside the existing `theme-color` one, since it turns out Android reads status-bar icon contrast from that independently — reasonable fix, except it turned out to be solving a problem that wasn't ours: on the actual device, the bug only reproduced on Chrome *Beta*, not stable Chrome. A browser-channel quirk, not a bug in the app. The meta tag's still correct to have, so it stayed, but this one's mostly a story about a very specific dead end.
- **A note's collaborator chip could get stuck forever — sitting right there on the card, doing absolutely nothing when you clicked it.** Didn't show up in quick testing, only after real multi-day use (devices closed or backgrounded between share/accept/leave actions), which made it a pain to even confirm was real. Turned out the on-device number deciding whether to show the chip was cached and only ever allowed to go *up*, never down — a note that once had a collaborator could never again be shown as having zero, even long after they left. Worse, "confirmed zero collaborators" and "haven't checked yet" were stored as the exact same thing, so the stale inflated number always won. Both are fixed now: a confirmed zero is tracked as its own real state instead of getting lost in the shuffle, and the cached count is only ever a fallback, never blended upward with a fresher number that says otherwise. Also closed a smaller gap where a missed real-time update — device offline at the exact moment a collaborator changed — wouldn't self-correct until a full app restart; reconnecting now triggers the same resync, not just cold-starting the app.
- **Leaving a note shared with you could hang forever on a bad connection** — button greyed out, modal just sitting there like it forgot what it was doing. The app only checked whether the browser thought it was *fully* offline, which a merely "connecting, technically alive" network sails right past, and only recognized a clean server error as a reason to fall back to the offline queue — not a request that just never comes back at all. Every request in this area now has an actual timeout so it fails fast instead of hanging indefinitely, and the app's own connection-status signal (which does catch "connecting") gets checked before it even tries. Covers leaving a note, revoking a collaborator, inviting one, canceling a pending invite, and generating a share link.
- **Adding a label or collection to a note shared with you just quietly failed if you were offline** — applied optimistically, then rolled straight back with an error dialog the moment the request failed, with nothing queued to retry later. Your own notes never had this problem (labels/collections live in the CRDT doc, offline by construction), but a shared note's placement metadata is a real server row, and this path never got the memo that the rest of note-sharing already lives by. Now queued and replayed automatically once the connection holds, same as everything else around it.

## 1.8.5 - 2026-08-03

### Changed
- **Round two on accepted-share placement: back to "appears at the front," not "scroll to it and pulse."** 1.8.3 shipped a scroll-to-and-pulse nudge for a freshly accepted shared note instead of reordering the grid, on the reasoning that reordering was more invasive than a one-time "here it is." On reflection that trade went the wrong way — scrolling to an arbitrary position in a workspace with hundreds or thousands of notes is its own kind of annoying, potentially paging through a large chunk of the grid just to see something appear for a second and fade. Accepted shared notes are now prepended to the front of the grid again (newest-accepted first among shared notes, ahead of your own notes), with no scroll and no pulse — removed that machinery entirely rather than leaving it dormant. Worth noting for testing: this isn't literally "the note gets inserted into your own note order like one you created" — shared notes are a separate group that always renders ahead of your regular notes, and don't get bumped down by newer notes you create afterward the way a real reorder would. Flagging this explicitly since it's still being evaluated against how this used to feel in earlier versions — real usage on production will tell us more than reasoning about it in the abstract.

## 1.8.4 - 2026-08-03

### Fixed
- **Switching between the Images/Links/Drawings tabs in the note editor's Attachments panel flashed a "Loading..." label plus a slide-up-from-bottom animation on every single switch**, even though the data was already sitting in cache. Didn't fit the offline-first feel this app is going for. Root cause was two-fold: the Images and Links tabs already had their content cached synchronously but still flipped on a loading flag the moment the panel mounted (which happens on every tab switch, since switching tabs remounts whichever panel wasn't showing), and the Drawings tab had no cache at all — it started empty and re-awaited every drawing's title and thumbnail render from scratch each time. Images and Links now refresh silently in the background instead of showing a loading state on mount; Drawings gets a small in-session cache so a drawing already rendered once just shows up immediately on the next visit. The slide-in animation (`mediaPanelSlideIn`, applied on every tab-panel remount) is gone entirely — tab content now just appears.

## 1.8.3 - 2026-08-03

### Fixed
- **Sharing a note with a collaborator before ever saving it (a brand-new, still-draft note) sent the invite immediately** — if you then canceled instead of saving, the collaborator was left with a "note shared with you" notification pointing at a note that no longer existed. Collaborator invites added to an unsaved note are now held locally and only actually sent once you save; canceling discards them along with the note, so nobody gets notified about something that never stuck around.
- **A "your note was accepted" inbox card stuck around forever, doing nothing, after you revoked the collaborator's access or they left the note themselves.** Now silently archived (removed from the inbox and its unread badge count) the moment access ends — no replacement notification, just gone, since a card that can't do anything shouldn't be sitting there either.
- **Switching to the Images view from the sidebar, then to Inbox, left the images gallery on screen underneath the inbox cards, overlapping both.** `sidebarView` (Notes/Trash/Images/Archive) and `viewMode` (Card/List/Strip/Bubble/Inbox) turned out to be two entirely independent pieces of state — switching view modes never reset which sidebar section was active. Bubble view already had a guard for this exact case; Inbox never got the same treatment. Both of Inbox's entry points now reset back to Notes when leaving Images.
- **On mobile, scrolling inside an open note could scroll the note grid behind it instead** — either after hitting the bottom of a long note, or immediately on a short one with nothing to scroll at all. The editor overlay deliberately allows touch scrolling (it needs to, for its own content), but was missing `overscroll-behavior: contain` on the actual scrollable note body outside of one narrow case (keyboard open), so a gesture with nowhere left to go fell through to the grid instead. Contained properly everywhere now.
- **Round three: the Samsung Copilot Search popup over the hyperlink URL field, again.** Last release's fix (`type="text"` + `inputMode="url"`) turned out not to actually change anything the keyboard could see — Android maps `inputMode="url"` to the exact same native input-type flag as `type="url"`, so Samsung Keyboard still classified the field as a URL field and kept showing the popup. Dropped `inputMode="url"` entirely this time; the field loses its `/` and `.com` quick-keys but should actually stop triggering the overlay.
- **Round three: the "Shared With Me" flash of personal notes, again.** 1.8.2's fix cleared the right state (`sharedPlacements`) on workspace switch, but the *refresh* that repopulates it afterward wasn't staleness-guarded the way its sibling state already was — a slow request closured to the workspace you'd already switched away from could still silently overwrite the new workspace's correct list with the old one's. Same race, one more unguarded write site. Guarded now.

## 1.8.2 - 2026-07-31

### Fixed
- **The "Shared With Me" flash-of-personal-notes fix in 1.8.1 wasn't actually fixed.** Turned out the previous attempt cleared the wrong state: `visibleSharedPlacements`'s "Shared With Me" branch reads from the global `sharedPlacements` array, not the `activeWorkspaceSharedPlacements` array that got cleared on switch. `SharedNotePlacement` carries no field for which workspace a placement is displayed in for the viewer (only `sourceWorkspaceId`, where the note originated), so there's no way to filter out just the old workspace's entries after the fact — the only fix is clearing the array outright on switch, same as its sibling already did. The notes that were flashing were never stale/corrupted data, either — they're real: notes shared directly into your Personal workspace (not routed through a "Shared With Me" folder) sitting at the root level, briefly shown in the wrong workspace's list until the next refresh corrected it.
- **Typing a URL into the hyperlink toolbar's input showed a "Microsoft Copilot Search" suggestion overlay on Samsung Galaxy devices, floating right above the keyboard.** Samsung Keyboard apparently attaches its own web-search-suggestion UI specifically to `type="url"` inputs. Switched to `type="text"` with `inputMode="url"` instead, which gives the identical URL-optimized keyboard layout (the `/` and `.com` quick keys) without the "this is an address bar" signal that was triggering it.

## 1.8.1 - 2026-07-31

### Added
- **Reminders now get an actual completion story instead of just piling up as bell icons forever.** Note card bells shift color as a reminder approaches (amber, same day) and once it's overdue (red), so the note grid tells you something useful at a glance instead of the same icon regardless of urgency. Opening a note with an overdue reminder shows a "Mark done / Reschedule" prompt right above the title. And there's a new **Reminders** tab in the Inbox — overdue and due-soon-within-48h reminders, grouped separately, each with inline Mark done / Reschedule and its own count badge — for the far more common case where you never reopen the note the reminder was on in the first place.

### Fixed
- **The add-collaborators dropdown (previous-collaborator suggestions) scrolled the whole invite section along with it** — username field, role picker, and all, instead of just the suggestion list. A leftover `overflow-y: auto` on the card wrapping the whole form was absorbing the dropdown's overflow into its own scroll area. Removed it; the dropdown's own internal scroll (which was already there and already correct) is now the only thing that scrolls.
- **Logging out could leave you stuck on the registration form instead of the login form**, and **brand-new accounts could land on the Inbox instead of Card view** — both traced back to state that gets set once and never reset. `authMode` wasn't reset on logout, and `fn_view_mode_v1` (view mode) turned out to be a single device-wide key rather than per-user, so a new account on a device where a previous account had left the view on Inbox would just inherit it. Both are now explicitly reset — one on logout, one right after registration.
- **Switching to "Shared With Me" briefly showed a few notes from your personal workspace mixed in with the correct shared ones, which then vanished a moment later.** A real, previously-latent race: the effect that refreshes shared-note placements re-runs on every workspace switch, but nothing canceled a *previous* call still in flight — if its async work resolved after the new workspace's, it would silently overwrite the correct data with the old workspace's. Added a staleness guard so a stale in-flight call can no longer clobber a newer one.
- **The hyperlink toolbar popover closed itself — and dropped the mobile keyboard — the instant you started typing a URL.** The popup's `<input>` is portaled straight to `document.body`, outside the editor's own DOM subtree, so the app's "is the keyboard still needed" check saw focus land there and concluded focus had left the editor entirely, which triggered an existing (and otherwise correct) "keyboard closed, blur whatever's focused" cleanup — except the thing it blurred was the URL field you were still actively typing in. Fixed by teaching that check to recognize the toolbar's own popovers as part of the editor. While in there: applying a link with no text selected now inserts the URL itself as visible clickable text instead of silently doing nothing.
- **The notification bell popup's "you have unread inbox items" card could get visually squeezed thinner than its own content** whenever several other notification types were also showing, since it had no protection against the flex layout shrinking it to make room. It now holds its natural size regardless of what else is in the popup. Trimmed the text size slightly across the whole popup while in there.
- Welcome note copy cleanup, English and Spanish: removed a mention of a right-click copy option that doesn't actually exist, clarified that auto-scroll works in text notes too (previously implied checklist-only), "arrow" → "lambda" for the heading-collapse icon description, and "local storage" swapped for plain language that doesn't assume the reader knows what that means.

### Changed
- Renamed the note editor's "Media" panel to **Attachments**, since it holds links and drawings now too, not just images — the images-only tab within it is now labeled "Images" so it isn't confusingly named the same thing the whole panel used to be called.
- Inbox tabs: "Assigned to me" shortened to "Assigned" (Spanish: "Asignados") since it was the one tab wrapping to two lines and throwing off the row's height. Tabs now scroll horizontally instead of wrapping at all, so this can't recur for a longer translation or a narrower screen.
- The condensed rich-text toolbar's "Formatting" section button used a bold "B" icon, which reads as "this is the Bold button" — except that section actually holds Bold, Italic, Underline, Strikethrough, Link, and Highlight. Swapped for a generic text-style icon.
- Toolbar mode (full vs. condensed) now actually defaults based on device type for new accounts — desktop gets the full toolbar, touch devices get condensed. It was quietly defaulting to condensed for everyone regardless of device, both client-side and in the server's own new-account defaults.
- The Markdown / Rich-text copy-mode picker (and its condensed-toolbar icon) now only appears when text is actually selected, instead of sitting there uselessly all the time.
- Desktop's row of 4 create buttons (Quick reminder / New note / New checklist / New drawing) redesigned into a single "+ New note" button with the other three revealed as icon buttons on hover or keyboard focus — same one-click access as before, but the row no longer wraps awkwardly at different window widths.

## 1.8.0 - 2026-07-29

### Fixed
- **Card banner icons were getting clipped in List view and Detailed List view on desktop** — the household icon's roof peak and a couple others were flat-cut at the top. The regenerated banner SVGs (new artwork, same canvas/position as before) turned out to be drawn slightly larger than the old hand-drawn ones, so they no longer fit inside the same crop window at 44px/64px row heights. Scaled the icon down uniformly across all 40 wide banner assets (light + dark, every category) rather than touching the crop logic itself, which was already correct.
- **The image viewer's top-right button was Delete, right where every other modal in the app puts Close** — easy to hit by habit and lose an image you didn't mean to. Replaced it with a Close button; deleting is still available (and always was) from the media panel itself, so nothing was actually lost, just moved out of the one spot muscle memory says is safe to tap.

### Changed
- Unraid Community Applications template polish: added the repository-level `ca_profile.xml` profile file CA submission requires (was missing entirely), removed a trailing slash from `<WebUI>`, added a Buy Me a Coffee donation link/message, and switched the template icon to a transparent-background mark that reads cleanly on both Unraid's light and dark themes.

## 1.7.9 - 2026-07-29

### Fixed
- **Right after drawing a new shape (rectangle, diamond, ellipse, line, or freehand), the properties panel that popped open didn't actually do anything — stroke color, background, opacity, none of it applied to the shape you just drew.** You had to switch to the selection tool, click the shape again, and only then could you edit it. Root cause: this app deliberately keeps the shape tool "locked" active after drawing so you can draw several shapes in a row without reselecting the tool — but Excalidraw's own logic for auto-selecting a shape right after you draw it is gated on that same lock being *off*. With it always on, the just-drawn shape never actually landed in the selection, so the panel that opened was silently showing "defaults for the next shape" instead of editing the one you'd just made. Text was never affected since it selects itself through a separate, unconditional path. Now the freshly drawn shape gets explicitly selected the moment its stroke finishes, so the panel is actually bound to it.
- **Deleting an image from a brand-new, not-yet-saved note didn't remove it from the media panel — it just sat there. Deleting it again then threw "Image not found."** The delete really did succeed on the server both times it looked like it "failed" once — but a pending-new note's media panel deliberately reads its image list from a local cache instead of the network, and the delete handler never pruned that cache on success (only the offline-queued-delete path did). So the image kept rendering as if nothing happened, and the second delete attempt on that same stale tile hit the server again, found it already gone, and surfaced the "not found" error. Fixed by pruning the local cache immediately on a successful delete.
- **Accepting a checklist autocomplete suggestion on mobile closed the keyboard — but only when the suggestion was long enough to wrap across two lines before getting ellipsized.** Short suggestions worked fine. Turns out this was the one tappable target in the checklist editor missing a guard every other control here already has (drag handle, checkbox, remove button, save button): a `mousedown`/`pointerdown` handler that stops the browser's default "focus whatever you just pressed" behavior before it fires. Without it, a long suggestion's messier tap geometry could let the browser blur the editor and dismiss the keyboard before the accept click handler even ran. Fixed in both places this logic lives — the standalone checklist editor and the checklist-embedded-in-a-text-note variant.

## 1.7.8 - 2026-07-28

### Added
- **Renaming an image before upload now actually does what it was built for — you can find it again by that name.** The rename box (defaults to "image 1", etc.) always saved the name you gave it, but search never looked at it — only OCR'd pixel text was indexed for images, meaning naming an image "Eng. Bld. Transformer" and later searching for it turned up nothing. Fixed on both the server (`/api/search`) and offline search, as its own "Image name" match badge (kept separate from "OCR" so the badge doesn't claim the app read text out of the image that it didn't).
- **Image quality is now a deployment-level setting** (`IMAGE_CAPTURE_MAX_DIMENSION_PX` / `IMAGE_CAPTURE_JPEG_QUALITY` env vars, default 2560px / 0.82) instead of a hardcoded constant, since "how much quality per image" is really a storage-budget call for whoever's running the instance — a 5-person self-hosted install and a 1,000-person org don't want the same answer. Documented in `.env.example`, `docker-compose.yml`, `third-party/freemannotes.xml`, and the README with a rough sizing estimate (~0.5MB/photo at the defaults) so you can budget storage before you configure it.

### Fixed
- **Toggling a checkbox in the rich-text editor while scrolled away from the caret snapped the view right back to it — Android PWA only, not desktop, not even Android Chrome as a regular tab.** Took three wrong guesses (a transaction-meta skip for `selectionUpdate`, reordering a blur, snapshotting/restoring `scrollTop`) before we stopped guessing and got real device console logs. Turns out none of it was a JS scroll write at all: Android lets you dismiss the on-screen keyboard via gesture without ever blurring the still-focused editor, and toggling the checkbox gave it a reason to pop the keyboard back up — which shrinks the viewport around an off-screen caret and *looks* exactly like a violent scroll jump. Fix: blur the editor DOM right after a checkbox toggle, but only on coarse-pointer devices — desktop never had this problem and blurring there would just be annoying.
- **Note card banners flashed the wrong color scheme for a beat before snapping to the right one** on a warm PWA reopen, or switching Grid → List → Grid. The async canvas-based color sampling had no cache that survived a page reload, so every mount re-sampled every visible banner from scratch — plus a separate bug where the sampled color never got cached at all if the component happened to unmount mid-sample (a fast view switch). Sampled colors now persist to `localStorage` with a 14-day TTL (so a future banner-art regen self-heals instead of serving stale colors forever), and the cache write no longer depends on the component still being around to receive it.
- **The collapsible-heading toggle icon — the little arrow next to a heading — was next to unusable on iOS, working roughly 1 tap in 20.** iOS Safari can suppress the synthetic `click` event that would normally follow a touch once `preventDefault()` runs on an earlier event in that same gesture (`pointerdown`/`touchstart`), and the toggle only ever lived inside that `click` handler — which iOS was routinely eating before it got there. It now fires immediately from whichever touch event arrives first, with a short-lived guard so the same tap can't double-fire it if a `click` does still sneak through afterward.
- **Long-pressing the FAB to drag it to a new spot could pop up the phone's native text-selection tool right on top of it**, like it thought you were trying to select a word. Nothing told iOS this content wasn't selectable — the FAB never got the same `-webkit-touch-callout`/`user-select: none` treatment the note card's own long-press menu already has. Now it does.
- **Hotfix: the Excalidraw editor could still crash with React error #185 while dragging or rotating a shape**, despite 1.7.5's fix for the "same" crash. Turns out that fix only covered one trigger: it de-duplicated the `selectedElementIds` awareness field, but dragging/rotating fires raw `pointer`/`button` awareness writes on every native pointermove event, and `y-excalidraw`'s internal handler calls `updateScene({collaborators})` unconditionally on *every single one* of those — even for your own cursor, with nobody else in the drawing. Same infinite synchronous cascade as before, just through a field the old fix never touched. Pointer/button writes are now coalesced to at most one real awareness write per animation frame — the same throttling every real-time multiplayer cursor implementation uses, so the cascade can no longer recurse fast enough to trip React's update-depth limit.
- **Hotfix: in-app camera capture looked noticeably worse than attaching a photo you'd taken with the regular camera app afterward**, despite both going through identical resize/compression code. The gap wasn't the processing — it was the source: the in-app camera was grabbing a frame from the live preview video stream, which is capped well below the sensor's actual still-photo resolution and encoded for smooth playback, not photographic detail (no autofocus lock, no HDR, none of what a real still-capture pipeline does). Now tries `ImageCapture.takePhoto()` first, which asks the camera hardware for an actual still photo — the same pipeline the OS camera app uses — before falling back to the old frame-grab on browsers that don't support it (Safari/iOS). Verified on a Galaxy S23 Ultra: a real 5.36MB still photo straight off the sensor, correctly downscaled from there.
- **Hotfix: offline image previews were compressed so aggressively that any photographed text was unreadable** — 400px and a 50KB cap, which was never going to survive a photo of a document, whiteboard, or label. Since this cache is purely what you *see* while offline (search runs off server-side OCR of the full-resolution original, not this thumbnail), bumped the ceiling to 1024px / 200KB — meaningfully more legible while still keeping a large image library's offline footprint in the hundreds-of-MB range rather than gigabytes. Existing cached thumbnails regenerate automatically the next time you're online (a version bump forces it — no re-upload needed).
- **Hotfix: an "Offline preview" pill/badge was showing up on lower-quality offline image previews** — removed from the note's media panel, the workspace images gallery, and the full-screen viewer's subtitle. The image itself is unchanged; it just doesn't announce that it's a fallback anymore.
- **Hotfix: the Unraid Community Applications template was gitignored from day one and had never actually reached GitHub** — its own `<TemplateURL>` pointed at a raw GitHub URL that 404'd. Found while trying to document a new setting in it. Turned out to also be the wrong file: `third-party/freemannotes.xml` was the actual template this project ships (already correctly named/located, just stale), so the root `unraid.xml` — including today's new `IMAGE_CAPTURE_*` settings — was merged into it and the root copy removed instead of publishing a second, competing template.
- **Hotfix: `CLAUDE.md` and one stray file under `memory/` were committed to the repo before `.gitignore` had rules for them**, so adding the rule later never actually removed the already-tracked files — a classic git gotcha (ignoring a path doesn't untrack it retroactively). Both are AI-assistant context files, not part of the app; untracked from the repo (still present locally, just no longer pushed).

## 1.7.7 - 2026-07-25

### Changed
- **The desktop TipTap toolbar (note editor, condensed mode, and checklist editor) got a real design pass instead of looking like a pile of icons someone forgot to finish styling.** Buttons are now grouped into logical clusters — marks, block type, lists, insert, align — separated by dividers that are actually visible, instead of one undifferentiated row where everything blurred together. The whole container went through two iterations: first an "elevated card" treatment with a shadow and rounded corners, which on review looked like a floating panel disconnected from the editor underneath it; then flattened to a borderless strip with just a single hairline border-bottom, so it reads as an attached header on top of the content instead of something hovering apart from it. The "Headings" button got a small dropdown chevron so it actually looks clickable. Mobile's toolbar was already fine and is untouched — all of this is scoped behind `@media (pointer: fine)`.

### Fixed
- **Checklist autocomplete suggested a completion the instant you clicked into an existing item, before you'd typed anything — and a stray click anywhere in the row could silently accept it, overwriting real content.** Example: items "AAA Beef" and "AAA" existed side by side; clicking into "AAA" alone (no typing) showed "AAA Beef" as a ghost suggestion, and a second, unrelated click submitted it. Suggestions now require actual typing in the current focus session — merely placing the caret in a row that happens to be a prefix of another item no longer counts. Both places this logic lives (`ChecklistEditor.tsx` for new/draft checklists, `NoteEditor.tsx` for existing ones) got the same fix.
- **Accepting a checklist autocomplete suggestion had no predictable, deliberate gesture.** Enter used to double as "accept the suggestion" whenever one happened to be showing, which meant Enter's behavior silently depended on hidden state. Enter now always just creates the next item. Accepting is now Tab on desktop (matching VS Code/Copilot-style inline-suggestion conventions — takes priority over the existing indent/outdent behavior only while a suggestion is actually showing, so it doesn't fight with checklist nesting) or tapping/clicking the ghost suggestion text on either platform. That click target is intentionally generous — anywhere from where the suggestion begins to the end of the row, across the row's full height — rather than the suggestion text's own tight glyph bounds, since a one- or two-character suggestion is nearly impossible to tap precisely otherwise.
- **Ghost suggestion text was too dark to read as a suggestion, especially in some themes.** Dropped from 90% to 40% opacity of the muted-text color so it reads as a faint, unconfirmed ghost instead of nearly-real text.

## 1.7.6 - 2026-07-23

### Fixed
- **New offline workspace showed a blank rectangle where a note card should be.** Switching to a brand-new offline workspace dragged stale shared-note placements along from the *previous* workspace, riding shotgun in the grid's `orderedIds` snapshot branch. The offline fallback in `refreshNoteShareState` then dutifully restored those ghosts instead of clearing them, so a blank skeleton card just sat there haunting the grid until the registry WebSocket got around to syncing online. Fix: `handleWorkspaceActivated` now resets `activeWorkspaceSharedPlacements` to `[]`, so a fresh `NoteGrid` instance stops inheriting some other workspace's leftovers.
- **Banner picker panicked with a raw "Failed to fetch" when offline.** Now it just says "You are offline." like a normal, well-adjusted UI element. If the banner list was already cached (localStorage or service worker), banners keep loading fine offline regardless.
- **The Notifications section was proudly displaying the literal string `common.offline`.** Turns out that i18n key never actually made it into `en.json`, `es.json`, or `FALLBACK_MESSAGES`, so `t('common.offline')` had nothing to return except its own key name back at us. It's defined now. Notifications and the banner picker both say the correct thing.
- **Banner picker offline mode was a lie — it still waited on the network even with a perfectly good cache sitting right there.** `listNoteBanners` now returns the cached list immediately (stale-while-revalidate) and quietly refreshes in the background. The cache is also warmed once right after login so the picker isn't empty-handed the very first time you go offline.
- **Clicking a link or @mention pointing at a trashed/deleted note either opened it anyway or just crashed.** `/api/notes/:id/access-check` now actually checks live Yjs metadata (in-memory doc if it's loaded, otherwise the persisted state) — the same trick the trash-empty endpoint and reminder trash guard already used. Now a mention chip to a trashed note shows a toast with a "Restore note" action instead of barging in, and a permanently-deleted note gets an honest "This note no longer exists." Both the rich-text mention chips and checklist-item preview chips funnel through the same gated `openLinkedNote` handler in `App.tsx` so this applies everywhere at once. Also fixed the browser history getting corrupted by pushing an entry even when navigation should've been blocked — it only pushes now when navigation actually happens.
- **Same bug, different door: an inbox @mention card for a trashed/deleted note opened it without asking.** The inbox's `onOpenNote` handler skipped the existence check that the note-link path already had. It now runs through the identical access-check gate — restore toast for trashed, "no longer exists" for gone-forever, and the useless inbox card auto-archives itself so it doesn't keep coming back like a bad habit. Cross-workspace/shared-placement cards are unaffected, and a trashed-but-not-emptied note can still be restored right from the toast.
- **Self-mentioning yourself in a note's very first save produced total notification silence.** The server intentionally holds off on mention notifications while `metadata.pendingNew` is set (nobody needs a ping for every keystroke of a draft), and only flushes the queue when `/api/notes/:id/flush-mentions` gets called — which normally happens via `closeNoteEditor`. The "Save" action on a brand-new note/checklist (`savePendingNewNoteAndClose`, and the drawing equivalent `saveDrawingEditor`) cleared `pendingNew` but never actually called flush-mentions, so a self-mention from before that first save sat queued server-side, going nowhere, until the note's WS room happened to disconnect. First-time saves now call `flush-mentions` immediately, same as closing an already-saved note always did.
- **Swiping an inbox card to archive it also, somehow, yanked the mobile sidebar open.** `App.tsx` has a document-level `touchmove` listener that opens the sidebar on a left-edge right-swipe (anything starting within 36px of the edge). `InboxView`'s own swipe handler didn't know that zone was spoken for, so a card swipe near the screen edge got claimed by both gestures simultaneously — chaos. Now the card swipe leaves anything starting in that 36px zone completely alone (no preventDefault, no stopPropagation) so it passes straight through to the sidebar gesture; past that zone, it calls `stopPropagation()` so its own swipe stops bleeding into the sidebar listener either. Two gestures, one screen, now properly divided instead of fighting over it.
- **Clicking an inbox card for a mention in a different workspace either crashed the app or opened a suspiciously empty note.** Inbox cards are cross-workspace by design — a mention from any workspace you're in shows up regardless of what's currently active. If there was no share-placement alias for the target note, `onOpenNote` fell back to opening it under whichever workspace happened to be active, which resolves to the *wrong* Yjs room entirely (`${activeWorkspaceId}:${noteId}` instead of `${notesActualWorkspaceId}:${noteId}`). Best case: an empty stub doc. Worst case: the server slaps back a "forbidden namespace" WS rejection and the app just dies. Now it confirms access first, switches the active workspace to the note's actual owner (reusing `activateWorkspaceFromSidebar`, same as the workspace switcher), and only then opens it — trashed/missing notes are still caught by the same gate as every other entry point.
- **Checklist drag ghost showed a fossilized @mention avatar and a checkbox that jumped sideways.** `@hello-pangea/dnd`'s `renderClone` fully unmounts the real row — including the live `ReferenceChip`/`useLiveUserAvatar` node view — and rebuilds a preview through a plain, non-reactive `renderRichPreview` helper. That helper painted avatars from `node.attrs.avatarUrl`, captured once at mention-insertion time and never touched again, so a profile picture change never made it to the drag clone. `renderRichPreview` now accepts the same `liveAvatarLookup` (from `useLiveAvatarUrlLookup`) that `NoteCard`'s static preview already uses. Also: the clone's checkbox was a bare `<input>` while the live row wraps it in a `.checklistCheckboxHitArea` label that CSS positions differently — the clone's checkbox now uses the same wrapper so it stops visibly shifting mid-drag.
- **New/draft checklists were quietly eating @mention and note-link chips out of row previews.** `ChecklistEditor.tsx`'s pre-save `renderRichPreview` had zero handling for `reference` nodes — a mention or note link in a collapsed/inactive row just vanished from the preview, only reappearing once the row got reactivated. It now renders the same reference chip (icon/avatar + label) as `NoteEditor.tsx`, live-avatar-lookup fix included; note-type chips render as static (non-clickable) since the draft flow has no note-navigation callback to hand off to yet.

### Fixed
- **Notes grid could scroll about half a screen past its actual content whenever a checklist card's completed-items dropdown was expanded — a known, annoying, load-bearing bug since v1.4.6, and the graveyard of several previous fix attempts.** The grid used to reserve a flat `50vh` of scrollable padding for as long as *any* completed section anywhere was open, leaving a standing dead zone below the last row like an empty parking lot nobody needed. Turns out that reservation only ever actually mattered at the exact instant a dropdown *collapses*: the grid shrinks in one layout pass, and if you're scrolled deep enough, the browser clamps your scroll position and every visible card jumps like it got startled. The buffer has to already exist at that moment — you cannot add it after the fact, the horse is already out of the barn. Expanding, on the other hand, only ever grows the grid, and growth below the viewport can't move anything, so it never needed a buffer at all. We were solving a problem that only existed on one side of the toggle. The buffer is now reserved synchronously only on collapse (sized to the collapsing card's own height, which always covers the shrink), trimmed down to the exact viewport overhang once the collapse has painted, and ratcheted monotonically to zero as you scroll away. Critically: the buffer only ever shrinks, and we never once write to `scrollTop` ourselves — which matters, because every earlier attempt that *did* try to reactively correct scroll position got into a shoving match with the OS's own momentum-scroll physics on iOS and oscillated like a caffeinated metronome. Nothing to fight this time. The real scroll container (usually the page; `.test-harness-root` on the installed iOS PWA) is found via the same walk-up-the-DOM trick as the note editor's `findScrollableAncestor`.

## 1.7.5 - 2026-07-22

### Changed
- **@mention scroll highlight redesigned to match the mobile FAB long-press pulse.** Same `cubic-bezier(0.2, 0, 0.8, 1)` easing, a white flash at 100ms, then the accent ring expands and dissolves — total runtime dropped from 2.4s to 1s. It also now waits for the smooth scroll to actually settle (500ms delay) before firing, so the burst lands at the chip's final resting spot instead of fading out mid-scroll like it gave up early.
- **Drawing editor mobile toolbar now scrolls horizontally** instead of running out of room. Fade masks on both edges hint that there's more to see. Palette, reminder, and collaborator buttons get appended to the end and reached by scrolling like everything else.
- **Drawing editor "More tools" dropdown now renders above the overlay, as intended.** The Frame / Embed / Laser picker is a React portal to `document.body` now, so it stops getting clipped by the toolbar's `overflow: hidden` scroll container.

### Fixed
- **Labels on a shared note would just permanently vanish.** The lazy cleanup effect that prunes stale label IDs (runs when a note opens) had no business running on shared Yjs docs, but it did anyway. When a collaborator opened the note, their *empty* label registry made every label ID — all belonging to the owner's workspace — look orphaned, and the effect happily wrote `[]` back over the top. The effect now skips any doc whose room ID isn't the current user's own workspace.
- **React error #185 crash when dragging shapes on a collaborative drawing.** The y-excalidraw binding calls `awareness.setLocalStateField("selectedElementIds", …)` on every Excalidraw `onChange`. Yjs awareness fires a `change` event even when nothing actually changed, so we got `_remoteAwarenessChangeHandler` → `updateScene({collaborators})` → `onChange` → repeat forever. A textbook infinite loop. The awareness object is now wrapped in a Proxy that de-duplicates `setLocalStateField` calls for `selectedElementIds`, which breaks the cycle before it starts.
- **Note card's 3-dot menu icon was riding a little too high on mobile.** After the 40×40 touch-target expansion in 1.7.1, the icon was dead-centered in the full button box (20px from the bottom) instead of tucked near the card corner where it belongs (~14px). Now anchored bottom-right with `align-items: flex-end` and mobile padding; desktop keeps its centered look inside the 50px hover-dock footer.

## 1.7.4 - 2026-07-19

### Added
- **Excalidraw drawing library now follows you across devices.** Custom shapes you add live server-side (`/api/drawing-library`) and load on every device tied to your account. Still loads from local cache when offline, because obviously.
- **Excalidraw library browser now actually works inside the PWA.** "Browse Libraries" routes the selected library back to the original editor via BroadcastChannel relay — handles both same-window in-place navigation (browser) and the cross-context relay-tab dance mobile PWAs need.
- **Avatar upload now works offline.** Cropped profile images apply immediately as a local `data:` URL and upload to the server in the background; if you're offline, the pending upload retries automatically once you're back.
- **Inbox now renders instantly on cold start.** Each filter tab's first page gets persisted to localStorage and shown immediately on open, before the server fetch even lands.
- **Mention notifications now wait until the editor actually closes.** @mention activities, invitations, and push notifications only fire when the last WebSocket client disconnects from a note room (or the editor explicitly closes). Type a mention, delete it, close the editor without saving — zero notifications, zero drama.
- **Mention role gets remembered within a session.** Mention the same person twice in one sitting and the second time skips the role picker, reusing whatever you picked the first time.
- **Server now waits patiently for PostgreSQL on reboot.** `dbInit.js` polls Postgres for up to 60 seconds on startup so the app can recover cleanly from a database restart without needing a manual app restart too.

### Fixed
- **Inbox badge was double-counting and going stale after archive.** Two separate bugs stacked on top of each other: (1) archive/read actions now wait for the server response before re-fetching the badge count, closing a race where stale data won; (2) the count endpoint now returns the nodeIds of unread mention activities so the client can immediately clear matching optimistic entries instead of counting them twice.
- **PWA update notice kept showing up every single reopen after you'd already updated.** When the installed version already matches the running version, the notification now clears itself. Shows at most once per upgrade, like it should have from the start.
- **Moving a note between workspaces duplicated inbox cards.** The move transaction now does delete-then-insert for `EntityReference`, `Activity`, and `NoteReminder` rows instead of assuming a clean slate, avoiding unique-constraint blowups when target rows already exist (note moved back, or a prior visit created them first).
- **`note_shared` inbox card kept reappearing after a cache clear or app update**, like some kind of notification zombie. On share acceptance, the server now immediately archives all `note_shared` activities for the acceptor, so it can't resurface on any later fresh fetch.
- **"Force clear all notifications" didn't actually reset the inbox badge.** The optimistic `pendingSelfMentions` list wasn't being cleared alongside the in-memory activity list. Now it is, and the badge actually drops to 0 like the button promised.
- **Mention activity wasn't archived when a share got accepted.** The acceptance endpoint now archives all `note_shared`-related activities targeting the acceptor, not just the one that kicked things off.
- **Self-mentions were being shown the role picker, which is a weird thing to ask yourself.** `authUserId` now gets forwarded to `ChecklistRowContent` and the TipTap reference extension so mentioning yourself skips the picker automatically.
- **Icons broke offline after a server restart.** Two bugs, one symptom: (1) the service worker's stale-while-revalidate strategy was evicting a perfectly good cached asset whenever a background revalidation returned a non-ok response (like a 502 mid-restart); (2) when a SW update installs while the server happens to be temporarily offline, assets that can't be fetched now get copied from the *previous* version's cache instead of silently dropped on the floor.
- **Drawing's anchor point jumped on the very first stroke.** `scheduleInitialViewportFit` now marks an empty canvas as already-fitted on open, so the first `onChange` doesn't trigger `scrollToContent` and yank the newly drawn element somewhere else.
- **Task list items were overflowing their container.** `min-width: max-content` on checklist rich-editor content divs is now `min-width: 0`, so long text actually wraps like text is supposed to.
- **Inbox avatar didn't update when a collaborator changed their profile picture.** Inbox activity cards now pull the actor avatar from the live avatar cache, so a profile-image change shows up immediately instead of on the next full reload.

## 1.7.3 - 2026-07-13

### Added
- **Note-link navigation now has a real back/forward history stack, across every platform.** Tapping a note chip (@reference, backlink) appends to an in-session note chain instead of just replacing whatever you were looking at. Android: system Back unwinds the chain one note at a time; the close/save button exits the whole chain in one shot (`history.go(-N)`). iOS/mobile: an explicit **← Back** button shows up above the note title whenever there's history to unwind. Desktop/browser: **← Back** / **Forward →** buttons in the editor header, plus `Alt+Left` / `Alt+Right` for the keyboard-shortcut crowd. Opening a note from the grid, inbox, search, or bubble view always starts a fresh chain — no inherited baggage.

### Fixed
- **Moving a note to another workspace duplicated inbox cards.** `server/apiRouter.js`'s move transaction now migrates `EntityReference` and `Activity` rows (the backbone of inbox mentions) to the new `sourceDocId`/`sourceWorkspaceId`. Without this, `_syncEntityReferences` found nothing on the other side and treated every @mention as brand new, minting a duplicate inbox card per collaborator.
- **Moving a note also silently dropped its reminders.** The move transaction now migrates `NoteReminder` rows too, so scheduled push notifications keep firing after the move like nothing happened.
- **Heading portal collapsed content and misaligned the toolbar dropdown** (welcome note / rich text editor). Clicking a heading now correctly highlights its level in the toolbar dropdown, and picking a heading type no longer collapses whatever's underneath the selection.
- **Image viewer closed itself on a downward swipe, whether you wanted it to or not.** That swipe-to-dismiss gesture is gone. Navigation controls (back, title, delete) now overlay the image with a dark-to-transparent gradient header, the image fills the full viewport on mobile, and desktop's max height goes up to `min(88dvh, 960px)`.

## 1.7.2 - 2026-07-13

### Fixed
- **PWA permanently claimed to be "version 1" in Android's app info screen.** `version` and `version_name` are now injected into the web app manifest from `package.json` at build time, so Android shows the actual semver instead of a lie.
- **Inbox badge double-counted pending self-mentions while online.** When `inbox_updated` fires and a fresh unread count comes in, the endpoint now also returns the `nodeId`s of every unread mention activity, and the client reconciles those against the optimistic `pendingSelfMentions` store immediately — clearing anything the server already processed. Badge stops inflating.

## 1.7.1 - 2026-07-13

### Added
- **New accounts get the Freeman BMRF Lab theme by default.** New registrations and post-cache-clear logins start there now instead of the generic dark theme.

### Changed
- **New-account defaults now get set server-side on first login.** Note card text size (85%), note editor text size (85%), max card height (400px), and condensed toolbar apply the moment a `UserDevicePreference` row is created — no UI fiddling required to get the intended starting point.

### Fixed
- **Pressing Enter on a checklist title didn't reliably jump focus to the first item.** Now it does, whether editing an existing note or making a new one; on an empty list it creates and focuses a blank item instead. Uses `editor.commands.focus()` via the TipTap API instead of a raw DOM selection, which was flaky on an empty ProseMirror doc.
- **Note card shrank after closing a checklist that had a blank item in it.** Blank items (created by pressing Enter and not typing anything) are now filtered out of the card preview, so `pruneEmptyChecklistRows` removing them on close doesn't change the card's height out from under you.
- **Checklist cards rendered too tall, then visibly shrank after switching views.** The row-height estimate for initial sizing was hardcoded at 26px, calibrated for 100% font scale. At 85% the real pitch is ~22px, so you'd get a visible snap. The estimate now derives from the live `--note-card-font-scale` CSS variable instead of a magic number.
- **Stale session cookie caused an FK constraint error after wiping the database.** `/api/auth/me` now clears the session cookie before returning `{ authenticated: false }` whenever it can't find a matching user (say, after a DB reset), instead of letting a stale JWT go on to blow up the next request with a foreign-key violation.
- **Note card's 3-dot menu hitbox was too small on mobile.** `.cardMenuButton` is now 40×40px (was 24×24px). Fat-finger-friendly.
- **Blue native touch highlight showed up on note list rows.** Added `-webkit-tap-highlight-color: transparent` to list and strip view rows.
- **PWA install prompt showed a generic 📱 emoji instead of the app icon.** Now shows `/pwa-192x192.png` like a real app.
- **Image sidebar was showing a redundant "Status: Ready" label.** Removed it. It was always ready. That's not information.

## 1.7.0 - 2026-07-09

### Added
- **Language picker on the register screen.** Pick a language during account creation and the whole UI translates immediately; the chosen locale gets sent along with the registration request.
- **Localized welcome note.** The feature-guide note every new account gets is now created in whatever language you picked. English and Spanish supported so far.
- **PWA install prompt after first login.** When a browser that supports app installation notices you've authenticated and the PWA is installable, a one-time dialog offers "Install Now" (fires the native install flow) or "Not Now." Shown once per user per device, never repeated once acknowledged — we're not that annoying.

### Changed
- **Welcome note — Markdown support.** The Note Types section now explains that Markdown syntax converts live as you type, and that pasted Markdown from anywhere converts automatically too.
- **Welcome note — Copy format options.** Explains that selected text can be copied as Markdown or Rich Text for pasting outside the app.
- **Welcome note — Collapsible Headings.** The "Collapsible Headings" heading is itself now collapsible, so you can just click the arrow and see the feature in action instead of reading about it. Also explains that a higher-level heading collapses everything below it at a lower level.
- **Welcome note — Auto-Scroll fix.** Corrected the description: it scrolls to the bottom of the note when opened, not after you check items off. We had it backwards.
- **Welcome note — Checklist Counts fix.** Rewritten for accuracy: click +1 to turn an item into a count item, use +/− to move the count, click the checkbox to turn it back into a normal item.
- **Welcome note — User Preferences section.** Added detail on text size, avatar upload, toolbar size, and card height/click-behavior preferences.
- **Welcome note — Mobile FAB section.** Explains that long-pressing the floating + button lets you drag it anywhere on screen.

### Fixed
- **Shared-device privacy: the user identity cache was leaking PII across logins — not great.** `userIdentityCache.ts` stored collaborator names, emails, and profile image URLs in `freemannotes.userIdentityCache.v1` with zero user scoping. A second person logging in on the same device could just see the previous person's contacts sitting there. `clearUserIdentityCache()` now wipes it (localStorage + in-memory) on logout.
- **Shared-device privacy: avatar URL cache had the same problem.** `userAvatarCache.ts` stored userId → profile image URL in `freemannotes.userAvatarCache.v1`, unscoped. `clearUserAvatarCache()` now wipes it on logout too.
- **Shared-device privacy: drawing thumbnail cache leaked note images across logins.** `drawingThumbnailStore.ts` stored base64 thumbnails from the previous user's notes in an unscoped `freemannotes.latest-drawing-thumbnails.v1`. `clearDrawingThumbnailLocalCache()` now clears the localStorage warm-start snapshot on logout. (IndexedDB is left alone — server access is already gated by workspaceId there.)
- **Shared-device privacy: Excalidraw's shape library leaked across logins.** `DrawingEditor.tsx` stored custom shapes in an unscoped `freemannotes:excalidraw-library`. Now scoped per-user as `freemannotes:excalidraw-library:<userId>`, with a one-time migration that moves any existing data from the legacy key into the new one on first open.
- **Shared-device privacy: the admin user cache leaked every registered user's PII, to any admin who happened to share the device.** `UserManagementModal.tsx` cached the full admin user list (names, emails, roles) in an unscoped `freemannotes.adminUserCache.v1`. `clearAdminUserCache()` now wipes it on logout.
- **FAB ghost-clicks: hidden action buttons kept receiving pointer events they had no business receiving.** When the FAB was collapsed, its four action buttons were invisible but fully clickable — tapping in that dead-looking space could silently fire note creation or another action out of nowhere. Fixed by scoping `pointer-events: auto` so it only applies when `.mobile-fab-stack.is-open`.

## 1.6.9 - 2026-07-09

### Added
- **Draggable mobile FAB.** Long-press the floating action button (500ms) to enter drag mode, release to drop it anywhere on screen. Position is saved per user + device to `freemannotes.fabPosition.v1` in localStorage using viewport-relative fractions, so it survives rotation and different device sizes without getting lost off-screen. The action pill stack adapts automatically — opens downward when the FAB is in the top half, extends rightward when it's on the left. Extracted out of the `mobileFabOverlay` useMemo in `App.tsx` into its own `MobileFab` component (`src/components/MobileFab/MobileFab.tsx`).
- **Long-press ring animation, because why not make it satisfying.** A two-layer SVG ring traces clockwise from 12 o'clock as you hold the FAB down — a wide glow layer lagged 40ms behind gives it a trailing-comet look. The button compresses to `scale(0.9)` during the hold, spring-pops to `scale(1.12)` at the 500ms threshold with a haptic pulse, and finishes with a ring-explosion exit (expands + flashes white + fades). Pure CSS (`@keyframes fab-ring-charge`, `fab-ring-fire-exit`, `fab-ring-fire-stroke`) — no animation library needed for something this small.

### Fixed
- **First tap after dragging the FAB got silently eaten.** After a drag that moved the pointer significantly, the browser doesn't fire a `click` following `pointerup` — so `wasJustDraggingRef` never got cleared and quietly ate the next legitimate tap. Now the stale flag resets at the start of every `pointerdown` instead of waiting around.
- **Sidebar swipe opened while dragging the FAB near the left edge — two gestures walked into a bar, only one left.** The app-level sidebar swipe detector listens on `document`, and even with pointer capture active it kept firing during FAB drag. `MobileFab` now adds a capture-phase `touchmove` listener with `preventDefault()` for the entire duration of both the long-press charge and the active drag, blocking any competing gesture handler cold.

## 1.6.8 - 2026-07-09

### Fixed
- **Holding down backspace in the note editor could crash the whole thing with "Maximum update depth exceeded."** Three `useSyncExternalStore` subscriptions in `NoteCard` were each calling `onStoreChange()` synchronously on every single Yjs `afterTransaction` event. Hold backspace and y-prosemirror fires roughly 30 transactions a second — more than enough to blow past React's 50-render depth limit and crash the UI outright. All four Yjs-driven card preview subscriptions (`useTextNoteRichPreview`, `useChecklistItems`, `useDrawingThumbnail`, `extractedLinks`) are now RAF-throttled, coalescing rapid transaction bursts into at most one React re-render per animation frame. `useChecklistItems`'s cache still updates eagerly/synchronously so the snapshot stays fresh even though the render itself is deferred.
- **Unpinning a note made it vanish and then fly back to wherever it used to live.** Pin state is user-scoped and stored separately from the canonical Yjs `noteOrder`. Unpin a note and `pinnedFirst()` (applied at render time) yanked it from the top, sending the card flying back to wherever it sat in the pre-pin order — visually jarring, not what anyone wanted. Now, unpinning writes the note's current visual position (index 0) into the canonical `noteOrder` via a Yjs transaction, treating the unpin as an implicit "actually, keep it right here" move. Works from both the card more-menu (`NoteGrid`) and the open editor toolbar (`App`).
- **Navigating to a linked note on mobile flashed the keyboard open and shut, for no reason anyone asked for.** Tapping a note chip (@reference) triggered `pointerdown` focus on the TipTap `contentEditable` before the click handler even ran, popping the software keyboard briefly before the old editor unmounted. `handleReferenceClick` in `RichTextEditor` now blurs the active element synchronously at click time, before the async access-check fetch, so the keyboard starts dismissing right away instead of after navigation finishes.
- **The notes grid was visible through the "Loading editor" overlay during note-to-note navigation** — not exactly the polished feel we were going for. The loading placeholder used `var(--color-overlay)` (45% opacity) as its background, so the grid bled straight through. Now opaque `var(--color-surface)`. Same fix applied to `DrawingEditor`'s Suspense and error-boundary fallbacks.
- **Notes grid was also visible behind the new editor on the very first render frame, mobile only.** `.fullscreenOverlay` uses `var(--color-overlay)` (45% opacity), which is fine once the editor card fills the viewport — except on the first paint frame, before the card has measured its own height, leaving the semi-transparent background exposed for one frame. Mobile now gets an opaque `var(--color-surface)` override, killing the single-frame grid bleed on editor open.
- **Six pre-existing TypeScript errors in `NoteEditor.tsx` and `NoteCard.tsx`, finally dealt with.** (1) `mediaSheetStyle` cast to `React.CSSProperties` to allow CSS custom property keys; (2) a `readonly ChecklistItem[]` snapshot cast to satisfy a mutable undo stack slot; (3) `titleFieldRef` typed as `(HTMLTextAreaElement & HTMLInputElement) | null` since the ref attaches to both element types depending on branch, and the intersection keeps every used method (`scrollHeight`, `setSelectionRange`, etc.) type-safe on both; (4) `getChecklistItemRichPreviewJson`'s parameter widened to accept `Y.Map<any> | null` with an early-return guard, closing off a potential runtime throw when a checklist item's map is absent; (5) `isElementLayoutMeasurable` now returns a type predicate (`element is HTMLElement`) so TypeScript actually narrows `card` after the guard; (6) swapped a `for...of` over `NodeListOf<HTMLElement>` for `Array.from(textNodes)` for compatibility.

## 1.6.7 - 2026-07-08

### Fixed
- **Inbox cards disappeared entirely when the device went offline** — the feed just blanked to "Sector clear" even with existing unread cards sitting right there. The filter-change effect cleared `activities` before fetching, and the offline fetch returned nothing, so the list stayed empty. `InboxView` now keeps a per-filter in-memory cache (`cacheRef`); tab switches show cached activities immediately, a background fetch refreshes when online, and offline just keeps showing the last-known state instead of nothing.
- **Switching inbox tabs caused a "Loading" flash and, offline, an indefinite freeze.** Every tab press blanked the list and spun a loader for the full network round-trip — and offline, that spinner just never went away (browser-level request timeout). The loading spinner is now suppressed whenever the filter already has cached data, and a 5-second `AbortController` timeout is applied to every fetch so the UI always resolves promptly no matter what.
- **@mention chip pulsed every single time a note was opened after inbox navigation, even long after the mention had been seen.** Clicking an inbox activity card sets `pendingMentionScrollNodeId` to scroll the editor to the chip. That value was only cleared by the explicit close-note path, not the mobile back-button path (`applyOverlaySnapshot`), so it stuck around and re-pulsed the chip on every subsequent open. A `useEffect` watching `selectedNoteId === null` now clears the scroll nodeId whenever the editor closes, no matter how it closes.
- **@ mention dropdown was empty on cold start + offline.** `UserReferenceProvider` fell back to an empty list when the workspace members LS cache was absent (cleared, or first session before the proactive fetch finished). The workspace list LS cache (`freemannotes.workspaceListCache.v1.<userId>`) — already used to populate the sidebar offline — happens to contain `ownerUserId`, `ownerName`, `ownerEmail`, and `ownerProfileImage` for every workspace you belong to. `initWorkspaceMembersCacheForUser` now falls back to that secondary source, so workspace owners show up in the @ dropdown under the same offline conditions the sidebar already handles.

## 1.6.6 - 2026-07-07

### Fixed
- **Offline self-mentions came back from reconnect with a broken avatar.** Mention yourself while offline, and the Yjs state syncs back to the server on reconnect via `messageYjsSyncStep2`. The server only called `recordDocUpdate` (which sets the activity's actor ID) for `messageYjsUpdate` messages, leaving `actorId = null` for sync-back updates — so the Activity row got created with no actor, and the inbox card showed initials instead of your face. `recordDocUpdate` is now also called for `messageYjsSyncStep2`, since the authenticated WS connection's userId is unambiguously the author of those accumulated changes.
- **Offline self-mentions also produced zero notification, full stop.** The server-side activity pipeline only runs on WS sync, so a self-mention created offline just went nowhere. Now an optimistic pending notification gets created client-side the instant you insert an @self chip — it appears at the top of the Inbox feed with your current avatar and the note title, and gets swapped for the real server Activity on reconnect (matched by the reference node's UUID). Clicking or swiping the pending card opens the note / dismisses it like normal. Entries persist to userId-scoped localStorage so they survive page reloads while offline.
- **The bell notification panel hid the inbox section entirely while offline, even with pending self-mention badges actively showing.** `ShareNotificationsModal` was getting `inboxUnreadCount` straight from the server (always 0 offline), so the inbox preview vanished right when it should've shown pending mentions. The prop now includes the pending self-mention count too.
- **@ mention dropdown was empty after a cache clear + going offline.** `UserReferenceProvider` only held workspace members in an in-memory module cache, wiped on every reload and never populated proactively. After a cache clear, typing `@` offline returned nothing until you'd typed `@` at least once while online first. Workspace members are now persisted to userId-scoped localStorage (`freemannotes.workspaceMembersCache.v1:<userId>`) and restored on login (`initWorkspaceMembersCacheForUser`), with a proactive background fetch on every login so the cache is warm before you ever type `@`. `refreshUserAvatarsCache` also stopped pre-clearing the cache before fetching — it updates in place now so the dropdown is never briefly empty mid-session.

## 1.6.5 - 2026-07-05

### Added
- **Import system.** Notes can now be imported from Google Keep Takeout ZIPs, plain Markdown files, and a few other formats. A new import UI (`ImportModal` → `ImportVerificationModal`) parses the archive, previews the notes, and writes them out as real Yjs documents. After import, a full-screen "Syncing notes…" overlay with a live progress counter covers the grid until every WS doc is confirmed received — the shimmer stall timeout is stretched to 3 minutes for freshly-imported workspaces so the grid never shows itself half-loaded.
- **Export note.** New "Export note" action in the card more-menu. Rich-text and checklist notes export as Markdown; drawings export as native Excalidraw JSON.
- **Welcome note for new users**, so first login doesn't land on a completely blank, faintly judgmental grid. `server/seedWelcomeNote.js` inserts a pre-written rich-text note on account creation — non-fatal if seeding fails, registration still succeeds.
- **Freeman theme family.** Six new Half-Life–inspired themes under a "Freeman" category in Appearance: Black Mesa, Xen, City 17, G-Man, Combine, and Freeman. Labels drop the redundant "Freeman:" prefix in the picker list.
- **Live avatar updates.** Profile picture changes now propagate in real time to every @mention chip and note card preview, no reload required. `liveUserAvatarCache.ts` is a reactive module-level store; `useLiveUserAvatar` (per-user, `ReferenceChip`) and `useLiveAvatarUrlLookup` (global, `NoteCard`) subscribe at different granularities to keep re-renders sane. `profileRouter.js` now emits `changedUserId` + `profileImageUrl` in the workspace metadata event so every connected client updates immediately.
- **Rich-text link menu with heading anchors.** The toolbar's link button opens a floating menu showing the current href plus every heading in the document as a clickable anchor target. Clicking one sets the link to `#slug` (GitHub-style slugification). Positions itself above the keyboard on mobile. Slugs resolve against the live ProseMirror doc rather than DOM IDs, avoiding timing dependencies on the MutationObserver.
- **In-editor TOC navigation.** Opening an editor with a pending mention scroll (`scrollToMentionNodeId`), or activating a `#slug` link inside the editor, triggers `scrollToSluggedHeading`, which walks the ProseMirror tree, finds the matching heading by slug, and scrolls to it. The editor blurs before scrolling on mobile so the browser's cursor-chase doesn't fight the programmatic scroll.
- **Inbox scroll-to-mention.** Clicking "View" on an inbox activity card with a `deepLink.nodeId` now passes `scrollToMentionNodeId` into the editor, which scrolls to and highlights the @mention node automatically.
- **Self-mention shortcut.** Mentioning yourself in the @ dropdown skips the role-picker and inserts the chip directly as EDITOR.

### Changed
- **Sidebar "Notes" entry now shows the workspace name.** The generic "All Notes" entry now displays the active workspace name with a small "WORKSPACE" eyebrow label above it. Bubble view keeps "All Notes" since it spans everything.
- **Scope chip label simplified.** No more "All Notes / Workspace Name" — just the workspace/path string, matching the sidebar change above.

### Fixed
- **"Move to Trash" reopened the note editor on mobile, which is the opposite of what trashing a note should do.** On coarse-pointer devices, `NoteCardMoreMenu` pushes a `{__moreMenu}` history entry; its cleanup calls `history.back()`, which fires a `popstate` that raced with `closeNoteEditor()`. The popstate handler now checks whether the note being restored is already trashed in its Yjs doc — if so, it applies a grid snapshot instead and `replaceState`s the stale overlay entry so forward/back navigation stays clean.
- **TOC fragment links in note card previews triggered a full navigation** instead of, you know, scrolling. Clicking a `#heading-id` link resolved against the outer document and reloaded the page. `getSafeHref` now blocks any href starting with `#`; these render as non-interactive styled text instead. Heading navigation is exclusively handled by the in-editor link menu now.
- **Shared-device privacy leak: @ mention suggestions.** `priorCollaboratorsApi.ts` stored collaborators under a flat, unscoped `freemannotes.priorCollaborators.v1` key that survived across user sessions. A new user on the same device could see the previous user's contacts in the @ dropdown, both from localStorage on cold load and from the in-memory module cache within the same tab session. The localStorage key is now user-scoped (`freemannotes.priorCollaborators.v1:<userId>`); `initPriorCollaboratorsForUser(userId)` runs on every login, `clearPriorCollaboratorsCache()` + `invalidateWorkspaceMembersCache()` run on logout, and the old unscoped key gets deleted on first login to mop up any data that already leaked.

## 1.6.4 - 2026-06-28

### Added
- **Inbox view and the @mention activity system.** Collaborators can now @mention each other inside rich-text notes, checklist items, and quick reminders. Mentions create a real-time inbox card for the mentioned user — an "Accept & View" button when access needs granting, or a plain notification when they already have access. Assignments (a mention next to a checkbox) surface as `assignment_created` cards. Accessible via the new Inbox nav button with a live unread badge.
- **Bell notification panel now shows an inbox teaser.** When the badge count includes unread inbox items, clicking the bell shows a compact "N unread mentions & assignments" card with an "Open Inbox" button — no more confusing "No notifications right now" while the badge is sitting there non-zero.
- **Draft-gate for @mentions.** Push notifications and inbox cards for @mentions are suppressed while a note is still unsaved (pending new). Mentions only get processed on save; discard a draft and it produces zero notifications, as if it never happened — because for notification purposes, it didn't.

### Fixed
- **"Accept & View" button was missing on assignment cards.** Inbox cards for `assignment_created` activities (a mention beside a checkbox in a checklist or rich-text task item) weren't showing the button. `showAcceptBtn` now includes `assignment_created` alongside `mention`.
- **Notification badge was double-counting mention invitations.** They were being counted in both `pendingShareNotificationCount` (via `/api/note-shares/invitations`) and `inboxUnreadCount`. The invitations endpoint now excludes `source: 'mention'` invitations from `pendingCount`, since those are already surfaced through the inbox.
- **"Clear all" in the inbox left a stale badge count behind.** The old `archiveAll` handler only sent the currently-visible page of activities to `/api/inbox/archive` — if you were on the "assigned" tab, unread items on "mentions" and "all" never got archived, and the badge stayed stubbornly positive. A new `POST /api/inbox/archive-all` endpoint archives every non-archived activity for the user in one transaction, no page-scoping gotchas.
- **User A didn't get real-time inbox updates when User B accepted a share.** After `emitNoteShareAcceptedActivity`, the server now also broadcasts `reason: 'inbox_updated'` via `onWorkspaceMetadataChanged` targeted at the inviter's userId, so their client re-fetches the inbox count without needing a page reload.
- **App icons and the inbox icon broke offline.** The header logo and inbox nav icon (`/icons/*.png`) were routed through `cacheFirstImage` in the service worker, which only checks `IMAGE_CACHE` with no fallback to `APP_SHELL_CACHE` (where `precacheAppShell` actually stores them on install). These paths are now classified as static app-shell assets via `isStaticAssetRequest`, routing through `staleWhileRevalidate` with a fallback to `APP_SHELL_CACHE` — available offline even on the very first use after install.

## 1.6.3 - 2026-06-26

### Fixed
- **Drawing images disappeared on reopen, as if they'd never been drawn.** Images added via the Excalidraw image tool were blank when the drawing closed and reopened. `ExcalidrawBinding` (which calls `api.addFiles`) only runs when a WebSocket awareness object is available, so offline or slow-connect reopens never got their files restored. A new `useEffect` on `[api, yAssets]` calls `api.addFiles` as soon as Excalidraw mounts, covering both the case where IDB already applied its state and the async case where IDB loads after mount via a `yAssets` observer.
- **Android hyperlinks discarded unsaved note data.** Tapping a hyperlink in an unsaved note editor while in Android standalone (PWA) mode navigated the WebView in-place (`target="_self"`), wiping all React state. Pressing back landed on a blank app. `getExternalLinkTarget()` now always returns `"_blank"`, opening links in a Chrome Custom Tab and leaving the PWA intact behind it.
- **Grouping filter chip label showed up blank.** Applying a group-by filter from the sidebar showed an empty chip at the top of the grid. `ScrollingScopeChipLabel` renders `chip.value` (scrolling part) and `chip.title` (static prefix), but the grouping chip was only setting `chip.label`. Added `title` and `value` fields to match the contract every other filter chip already followed.
- **Background scroll leaked through modal overlays on touch devices.** Touching the dim background beside a modal scrolled the notes grid behind it, which felt broken even though technically nothing was. Added `touch-action: none` to the overlay element in `PreferencesModal` (main overlay + the `subOverlay` covering User, Appearance, Note Management), `SendInviteModal`, `MetadataModal` (shared by Manage Labels/Collections), and `WorkspaceSwitcherModal`. `touch-action` doesn't inherit, so each modal's children keep their normal scroll behavior.
- **Cross-column drag reverted to the original position — a dead-zone no-op that looked like a bug even when it technically wasn't one.** The drag preview showed the right insertion point but snapped back on drop whenever the destination's row-major index in `flattenColumns` happened to match the note's existing canonical position, since `applyTierReorderToCanonicalVisible` produced an unchanged order and the Yjs write got skipped entirely. Fixed with a cross-column swap fallback: when the post-drag flattened order equals the pre-drag canonical order but the note's column changed, the dragged note swaps with whatever note occupied that column slot before the drag.

## 1.6.2 - 2026-06-24

### Added
- **PWA session restore after page discard.** Android/iOS can silently kill the PWA process while backgrounded (`sessionStorage` dies, `localStorage` survives). `src/core/sessionRestore.ts` writes the open note to `freemannotes.session-restore.v1` on every navigation change; after auth completes, a once-per-session effect re-opens the note if the stored workspace matches. Cleared on sign-out. Needs a local test to believe: open a note, background the app 5–10 min, come back — should restore instead of dumping you on the grid.
- **SW debug logging.** Service worker lifecycle events (install, activate, cache hits, update checks, navigation) now get captured to localStorage and surfaced in Preferences → Developer Tools (10-tap dev mode). Buttons for enable/disable, copy log to clipboard, clear log. Documents PWA reload regressions without needing DevTools plugged in. Full event reference lives in `CONTRIBUTING.md`.
- **i18n for the developer tools UI strings.** All the dev tools panel labels now use `t('prefs.devTools*')` keys instead of hardcoded English. Spanish translations added, fallback entries added to `FALLBACK_MESSAGES`.

### Fixed
- **Deleting a label left stale chips scattered across notes.** Deletion only removed the label from the registry and the one note open in the labels modal — every other note kept the chip visually, forever. `handleDeleteLabel` now iterates every loaded note doc via `manager.peekDoc` after the registry delete and strips the label everywhere. A `useEffect` on `openDoc` does lazy cleanup for docs that weren't in memory at delete time, pruning any IDs no longer present in the registry on note open. The first-click confirmation button now shows the affected note count from the workspace render snapshot.
- **Same story for collection deletion.** `handleDeleteCollection` clears `collectionId` across all loaded docs; lazy cleanup prunes stale IDs on open. `window.confirm` now includes the note count: `Delete "{name}"? {count} note(s) in this collection will be unassigned.`
- **Label/collection duplication when moving notes into an offline workspace.** If the target workspace had never opened a WS session (e.g. created while offline), its labels/collections registry had no live doc and no DB row. The server created new Yjs `Y.Map` entries per remapped label/collection; when the offline client later synced, Yjs's append-only `Y.Array` kept both — duplicates. `loadWorkspaceDocRow` now returns `wasEmpty`. `ensureTargetLabelIdsForMove` and `ensureTargetCollectionIdForMove` accept `targetWasEmpty`; when true and the client supplied a `preferredTargetIdsBySourceId` entry, they use the preferred ID directly and skip writing new Yjs entries. The empty registry also stops getting persisted to DB, so a blank server snapshot can't clobber the client's offline state on sync.
- **Undo/redo re-opened the software keyboard on mobile, which is not what "undo" implies.** The bottom-left FAB undo/redo buttons (visible only when the keyboard is dismissed) called `.chain().focus()`, re-focusing the editor and popping the keyboard right back up. Separate no-focus variants (`handleTextUndoNoFocus`, `handleTextRedoNoFocus`, `handleChecklistPrimaryUndoNoFocus`, `handleChecklistPrimaryRedoNoFocus`) now drive the FAB buttons specifically. The in-keyboard TipTap toolbar undo/redo still calls `.focus()`, since that one's supposed to.

## 1.6.1 - 2026-06-22

### Added
- **Sidebar reminders "All" section.** New `has-reminder` filter mode surfaces every note in the workspace with any reminder set, regardless of due date. Shows up first in the Reminders sidebar group.

### Changed
- **Masonry tail-balanced column layout.** Column slot allocation now starts from round-robin sizes, then iteratively transfers one slot from the tallest column to the shortest (up to 4 passes, 150px minimum imbalance threshold). Only the bottom rows of the tallest column ever move — canonical note order and the `flattenColumns === renderedIds` invariant both stay intact. Fixes the uneven columns that showed up once canonical order got unified across device widths.

### Fixed
- **Notes grid scrolled during modal open/close on desktop, then snapped back — visually unsettling for no functional reason.** Opening a modal (image upload, label, collection, move, collaborator) while scrolled down would visibly scroll the grid, then snap back on close. `useBodyScrollLock` now applies `html/body overflow:hidden` via a JS inline style guarded by a `pointer:fine` media query; Chrome desktop preserves `window.scrollY` under `overflow:hidden`, so the grid position just stays put. Mobile unaffected (touch-action only there).
- **Preferences modal Back button was a bare, unstyled `←`.** User and Appearance sub-sections referenced an undefined `iconButtonLeft` CSS class. Replaced with a proper `← Back` text button in `.subFooter`, matching every other section.
- **Preferences Notifications Back button was hidden behind scroll on mobile.** It sat inside the scrollable recent-deliveries area, unreachable without scrolling all the way down. Now sits in a `position: sticky; bottom: 0` footer outside the scroll container. Recent delivery log capped to 4 entries everywhere.
- **Checklist autocomplete ghost text overflowed the note card.** Long suggestions ran across multiple lines. Now capped at 2 lines with `…` via `-webkit-line-clamp: 2`.
- **Android camera activity hid the media handle.** Camera and file-picker transitions on Android cause a transient Visual Viewport shrink that `useKeyboardHeight` was misreading as a software keyboard, collapsing the media sheet. `mobileKeyboardOpen` is now a `useMemo` that additionally requires focus inside the editor overlay and no image-upload modal open, filtering out the false-positive shrinks.
- **Bottom-dock Add Image button skipped the media sheet entirely on mobile.** Tapping it launched the upload modal directly, so the sheet stayed closed after confirming the upload. The handler now expands the media sheet before calling `onAddImage`, so it stays visible post-upload like it should.

## 1.6.0 - 2026-06-21

### Added
- **BubbleView `notesStable` flag.** `useBubbleNotes` now returns `{ notes, notesStable }`. Gates `stableFilteredNotes` updates and CSS transition enablement so nothing repacks or snaps while inactive workspaces are still streaming in from IDB.
- **BubbleView `layoutChangeKey`.** Encodes `${containerWidth}:${Math.round(effectiveZoom)}`; the disable `useLayoutEffect` fires on this key so zoom-slider drags and window resizes snap bubbles immediately, while score-driven repositioning keeps its slow, organic transitions.

### Changed
- **BubbleView debounce raised from 120ms to 5,000ms.** Score buckets only change on ≥5-min granularity anyway, so the longer debounce batches rapid Yjs `updatedAt` writes during collaborative editing without losing any actual scoring signal.
- **BubbleView content/checklist Yjs observers removed.** `onContentChange` and `onChecklistChange` were firing on every keystroke without affecting scoring at all — dead weight. Only `meta.observe` and `titleText.observe` remain wired in `useBubbleNotes`.
- **BubbleView `cloudRef` / `hasMeasuredCloud` — now ResizeObserver-only.** The synchronous pre-warm call no longer sets `hasMeasuredCloud=true`; only the ResizeObserver callback does, so bubbles never position against a width the browser hasn't actually finalized yet.
- **BubbleView size-class gate for `stableFilteredNotes`.** `packedLayout` deps now use `stableFilteredNotes` (updated only when `notesStable=true` and a size class actually changed) instead of raw `filteredNotes`, eliminating streaming repacks and minor-EMA micro-repositioning that nobody asked to see.
- **BubbleView CSS transitions slowed way down, on purpose.** `.cloudItem` width transitions went from 640ms cubic-bezier to 2,500ms/4,000ms ease-in-out so score-driven drift reads as imperceptibly slow rather than "why is this bubble twitching."
- **BubbleView two-`useLayoutEffect` pattern.** The disable effect reacts to `layoutChangeKey` only (not `notesStable`); the enable effect requires both `hasMeasuredCloud` and `notesStable`, with a `requestAnimationFrame` delay before enabling transitions.
- **BubbleView CSS overflow fix.** Removed `overflow-x: hidden; overflow-y: visible` from `.cloud` and `.container` — the CSS spec quietly computes that pair as `overflow-y: auto`, creating a scroll container that clipped transitioning bubbles and produced spurious scrollbars nobody wanted.
- **Camera capture button in `NoteImageUploadModal`.** Swapped a hand-drawn CSS button (nested spans + circle CSS, a whole ordeal) for `<img src="/icons/Capture.png" />`. Sometimes an image is just easier.
- **`PreferencesModal` X button now closes instantly.** The root modal X calls `onCloseDirect` (via `commitOverlaySnapshot('replace')`) instead of `history.back()`, killing the extra back-navigation step nobody wanted.
- **`PreferencesModal` sub-section X now closes the entire modal.** New `onCloseAll` prop — sub-section X closes everything instead of just bouncing back to the list.
- **`PreferencesModal` Back button relocated to the footer.** Moved from the top-left header to a `← Back` button in `.subFooter`, bottom-left, matching the sub-sections pattern established elsewhere.
- **`PreferencesModal` About section icons.** Switched from PNG imports to static `/icons/` URL paths — fixes broken images in production builds.

### Fixed
- **Collaborators stopped appearing in the sidebar after a note move.** `handleMoveNote`'s success path now calls `bumpCollaborationRefreshToken()`, forcing the sidebar to reload collaborators for the note's new workspace location.
- **BubbleView bubbles flickered on every single collaborative keystroke.** Content and checklist observers removed from `useBubbleNotes`; the 5s debounce now batches remaining metadata changes instead of reacting to every character typed.
- **BubbleView streaming-load jitter.** `stableFilteredNotes` stays frozen while `notesStable=false`, so no partial repacks happen while individual workspaces load in parallel.
- **BubbleView snap-on-view-switch (bubble→list→bubble).** `hasMeasuredCloud` is now only set from the ResizeObserver callback, never the synchronous pre-warm, so bubbles never position against a stale width before layout is actually final.

## 1.5.9 - 2026-06-20

### Fixed
- **List/strip view scroll jumped to the top after drag-and-drop, undoing the whole point of scrolling down.** Two-part fix: (1) `dragColumns` in `NoteGrid` now uses `renderedIds` (which includes the pending committed order) instead of stale `visibleIds` when the drag preview clears, so row order stops reverting at drop; (2) `NoteListView` keeps window virtualization enabled during drag — toggling it off remounted the whole list, collapsed document height, and reset `window.scrollY` in the process. Neighbor shift animations now run via document-space flip on mounted rows instead, with wider overscan during drag/drop settle.

## 1.5.8 - 2026-06-20

### Added
- **Bubble view float animation restored.** The `bubbleFloat` keyframe, per-bubble `--bv-float-duration`/`--bv-float-delay` CSS variables, and hover `animation-play-state: paused` were all still intact — a stray `animation: none` added during virtualization work had just silenced them. Restored to `animation: bubbleFloat …`. Sometimes the fix really is that boring.

### Changed
- **Excalidraw editor defaults.** New drawings now open with Nunito as the default text font, thin stroke width, architect sloppiness (0), and sharp edges. Existing drawings keep restoring their own saved `appState` — nothing retroactive here.

### Fixed
- **Excalidraw drawing anchor landed at the wrong position.** The `syncViewportOffsets` effect that keeps Excalidraw's `offsetTop`/`offsetLeft` in sync with the canvas's real viewport position was guarded on `usesMobileEditorLayout` only, so on desktop the offset just stayed at 0 — first-click anchors landed at some incorrect scene position, usually dead center of the screen. Guard removed; sync now runs on every device type.
- **List view untitled notes showed nothing instead of `(untitled)`.** Now shows the localized `(untitled)` label in both list and detailed-list views, matching note card and search behavior.
- **List view drag ghost didn't match the real note row.** Ghost icon, title, content, and 3-dot menu now exactly mirror the live row layout for all note types (text, checklist, drawing) in both list views.
- **Mobile FAB vanished after a banner image change + sidebar open — a weird combo bug.** `NoteBannerPickerModal` now pushes a `__noteBannerPicker` history entry on mobile; `App.tsx` recognizes it as a dismiss-layer state and corrects a stuck `isMobileSidebarOpen: true` condition that was blocking the FAB.
- **"Move to workspace" modal allowed background scroll.** `useBodyScrollLock` added to `MoveNoteModal`, so the note grid stops scrolling behind the modal on iOS and desktop.
- **Note banner warm-start pop-in / stale-removal.** A `noteBannerWarmCache` (localStorage) now gets written at every banner assignment and read by `createSnapshotDocFromWorkspaceRenderSnapshot`, ensuring the correct banner state is present on the very first paint of a warm restart.
- **Cold-start drag animations didn't work on the first drag after boot.** `cardPositionAnimationsReady` now bypasses startup gates whenever a drag is active, so neighbor cards animate correctly on the very first drag after a cold boot instead of just teleporting.

## 1.5.7 - 2026-06-15

### Added
- **`noteCardDragMediaRetention` module.** Retains blob URLs for image/drawing card previews for the duration of a grid drag, so cross-column remounts don't revoke URLs the markup ghost is still holding onto.
- **Collapsible heading section-boundary test.** `tests/collapsible-heading-boundaries.test.js` covers collapsible-only section ownership, nested collapse, and markdown-it `horizontalRule` ad blocks between headings.
- **i18n locale key rule for agents.** `.cursor/rules/i18n-locale-keys.mdc` (local only); workflow documented in `memory/i18n.md`.

### Changed
- **Drawings panel tab now lists the drawing's name and relative created date** instead of the generic "Drawing preview ready" / element-count copy.
- **Search results and filter chips now use i18n for `Collection:` / `Label:` prefixes** (`search.collectionPrefix`, `search.labelPrefix`, `search.matchCollection`, `search.matchLabel`; en + es).

### Fixed
- **Cross-column note-card drag was dropping media previews mid-flight.** Blob URLs are now retained during drag and revoked only after drop-settle; `NoteCard` defers revoke while retention is active.
- **Drag-start flash on media/drawing cards.** The grid drag ghost now uses a synchronous HTML markup snapshot only — never a live `NoteCard`, never `placeholderHiddenDragId` (that path was duplicating the card in the grid, which explains a lot).
- **Desktop search clear control had gone missing.** The × button clears the search bar and results again, on both desktop header and mobile search overlay.
- **Collaborator modal layout shifted right on open.** Removed a syncing label that was shifting layout; accordion manage sections now stay mounted until access resolves (`showManageSections`); cached share links hydrate in `useLayoutEffect` before paint so link rows don't pop in one at a time like a slot machine.
- **`SendInviteModal` prior collaborator suggestions on focus.** The identifier field now shows the privacy-scoped suggestion list on focus, matching `CollaboratorModal` behavior.
- **Collapsible heading section boundaries.** Collapsed sections now end at the next **collapsible** heading of the same or higher level — non-collapsible headings no longer break multi-H1 pasted markdown collapse.
- **Nested collapsed heading parent expand/collapse flashed on the way in.** Section hidden state and collapsible heading decorations now apply before parent opacity fades, instead of racing it.
- **Markdown horizontal rules inside collapsed sections.** Sections containing `horizontalRule` nodes now collapse instantly so `<hr>` atoms don't get left visible mid-fade like an afterthought.
- **Collapsible heading toggle got stomped by a stale prefs echo.** A 3s recent-local-write guard now preserves optimistic collapse toggles when a debounced preferences API or websocket snapshot arrives stale and tries to overwrite what you just did.

## 1.5.6 - 2026-06-14

### Added
- **Collapsible rich-text heading polish, made production-ready.** In-flow opacity fade animations for collapse/expand, Enter-to-write under collapsed headings with transient "Writing..." feedback, and scoped per-note collapse-pref subscriptions to avoid grid-wide re-renders every time someone clicks an arrow.
- **Heading collapse debug tooling.** Enable via `localStorage.__headingCollapseDebug = '1'` and summarize with `window.__printHeadingCollapseDebugSummary()`.

### Changed
- **Warm PWA grid startup now honors cached pin order immediately.** `pickRenderedDisplayOrder()` bridges warm layout cache and live pin snapshots; workspace render snapshots persist user-scoped pin state; virtual columns remeasure when note order changes.

### Fixed
- **Collapsible heading expand/collapse animations.** Removed a two-phase expand spacer that was causing empty gaps and missing fades; decoration refresh is now sequenced so opacity animations actually run reliably on PWA/production builds instead of just in dev.
- **Collapsible heading chevron hit-testing.** The toggle hitbox is now anchored to the chevron icon, so the caret can be placed after the last heading character while coarse pointers still keep a 44px target.
- **Collapsible heading summary UI.** Removed the persistent `• N lines` / item-count text beside headings; "Writing..." now clears on note save/close, and empty draft paragraphs get pruned instead of lingering.
- **Warm-load pinned notes were missing from the top of the grid for a beat.** No more pop-in-a-beat-later when the layout cache already had the correct pin-tier order.

## 1.5.5 - 2026-06-13

### Added
- **Note pins are now per-user preferences, synced across devices.** Pin state lives in `UserPreference.notePinsByDocId`, hydrates on login, and broadcasts through the existing user-preferences pipeline — so each user's pinned notes follow *them*, without rewriting the shared Yjs note order out from under everyone else.
- **Quick reminder creation from the notes workspace.** A dedicated quick-reminder modal creates a text note and registers its reminder in one flow, right from the top actions row.
- **Collapsible rich-text headings in note editors.** Heading blocks can now collapse and expand in text notes, with per-device collapse preferences synced through user preferences.
- **Centralized reminder lookup utilities.** Reminder state for cards, filters, and editors now flows through shared lookup helpers, so doc/note IDs, local cache, pending offline mutations, and server refresh actually reconcile consistently instead of occasionally disagreeing with each other.

### Changed
- **Pinning and grid drag now use a display-layer pin tier on top of canonical note order.** Yjs `noteOrder` stays manual/canonical; pinned notes sort to the top for display purposes only, drag commits reorder within the active pin tier, and cross-tier neighbor shifts no longer mix pinned and unpinned cards during drag previews.
- **Card-grid reading order stays stable across viewport sizes.** Masonry columns are now packed in round-robin reading order instead of height-greedy placement, so A→B→C→D order no longer reshuffles just because the column count or card heights changed.
- **Cross-column drag hit-testing is hybrid again.** The first insertion into a foreign column follows pointer Y; once the dragged card adopts that column, row hit-tests switch to the same ghost-edge logic native in-column drags already use.
- **Mobile/PWA checklist editors now scroll through completed-row handles instead of getting stuck on them.** Non-draggable completed-item grip icons no longer block vertical page scroll along the left edge.
- **Touch note-card drags no longer lock root overflow.** Scroll suppression during touch drag now uses `touch-action` and grid-level `preventDefault` instead of `overflow: hidden` on `html`/`body`, which was breaking the sticky scope chip whenever the page was already scrolled.

### Fixed
- **Drawing note cards could be long-pressed to drag from the preview image itself**, which is not where a drag should start. The thumbnail no longer intercepts the grid's coarse-pointer drag gesture.
- **Pin and unpin no longer flash thumbtack badges or shuffle columns multiple times on the way to settling.** Display-order updates now sync on the same render pass, pin-tier settle gates stop re-arming on pin toggles, and preference POST responses include `notePinsByDocId` instead of wiping local pin state out from under you.
- **Reminder bell icons now clear on every device when a reminder is deleted**, not just the device that deleted it. Server reminder refresh no longer preserves stale local lookup entries for notes removed on another client.
- **Push reminder sync and notification deep links are generally more reliable now.** Reminder state changes broadcast to connected clients, preference API responses consistently include pin/reminder fields, and installed/PWA flows handle notification navigation more predictably.

## 1.5.4 - 2026-06-06

### Added
- **Bubble-view mode switches now carry traceable layout diagnostics.** View-mode changes can stamp a transition trace ID through the bubble layout path, so intermittent warm-switch or repack issues can actually be inspected instead of requiring a one-off logging patch every time.

### Changed
- **Bubble view and reminder navigation behave more intentionally across device sizes now.** Bubble cards use steadier packed layouts without the idle float animation, collaborator counts are cached between renders, zoom/detail scaling is tuned more carefully across mobile and desktop widths, and the sidebar Reminders section now includes `Past Due`.
- **Note-card action chrome adapts more cleanly to whatever input model is actually in play.** Mobile note cards keep the persistent corner 3-dot entry point, desktop cards keep the footer-dock menu action, and desktop more-menus stay aligned with their source card while clamping fully inside the viewport instead of drifting off-screen.

### Fixed
- **Touch note-card dragging froze whenever it crossed a column boundary.** Coarse-pointer card drags now use the same pragmatic drag path as the (already-working) title/banner handle path, with steadier cross-column insertion cooldowns and cleanup, so whole-card drags can actually move between columns without seizing up.
- **Desktop/tablet editors and checklist controls were inconsistent with each other.** Fine-pointer editors now cover the full app shell, duplicate checklist save/close chrome is gone, checklist footer undo/redo stays wired after keyboard dismissal, and the shared autoscroll toolbar control now renders correctly across draft and existing note/checklist editors.
- **Note-card and editor actions were losing or clipping key controls.** The desktop dock regained its 3-dot action, desktop more-menus no longer open partly off-screen, and note-card menu spacing stopped cutting off preview rails while still keeping the open menu visually tied to its source note.

## 1.5.3 - 2026-06-04

### Changed
- **Mobile media sheets now use one anchored drag-following model across saved and draft editors.** Saved notes plus the draft text and checklist editors now share the same handle-anchored mobile media sheet behavior, note-color-driven media panel theming, and stable collapse/open transitions, so the sheet tracks the dock instead of floating around like a separate overlay.
- **Shell branding and quick-create icons are cleanly separated again.** The header/splash app icon now uses its own stable branded asset path, the mobile FAB keeps its dedicated theme-aware button artwork, and the Appearance preference now just labels the display controls `Display`.

### Fixed
- **Saved-note and draft media-sheet regressions, resolved.** The checklist editor regained its missing Media header/handle, the sheet no longer starts below the dock or duplicates handles, dock chrome stays visible during collapse, and the drawings tab no longer shows the lingering "linked drawings" placeholder copy that had outlived its usefulness.
- **Banner, icon, and drag-preview polish regressions, cleaned up.** The Select banner image modal now blocks background touch scrolling, the original app header/splash image renders reliably again, the FAB rotates correctly on open, and dragged note ghosts no longer shrink across grid, list, or strip views.
- **Light note-color control contrast was inconsistent.** White and other light note colors now keep readable checklist controls and media drag handles with the intended dark-contrast treatment, instead of going pale-on-pale.

## 1.5.2 - 2026-06-03

### Changed
- **List and detailed-list note rows communicate note type more clearly now.** Desktop list-like views use width-based column breakpoints so they resize more predictably, list rows use larger note-type icons, drawing notes get a dedicated drawing icon, and detailed-list previews stay aligned directly beneath the title instead of drifting.
- **Bannered note cards now follow the selected card color more closely.** Explicit note colors drive a stronger shared banner/title tint treatment, so colored cards read as one coherent surface instead of the banner's original hue fighting the card color for attention.

### Fixed
- **Development startup and locale bundling were shaky.** The dev server now uses dedicated web/server helper scripts, locale JSON is bundled from `src/locales`, and the recent duplicate banner-preference import regression no longer breaks Vite startup.
- **Banner artwork didn't load reliably in Linux/Docker production builds.** The banner asset set now follows one lowercase on-disk naming convention across both theme folders, the dark-theme typo in the travel list asset got fixed, and banner URL generation now normalizes stored filenames before resolving paths on case-sensitive filesystems — a classic "works on my Mac" bug.
- **Banner pickers didn't populate at all in Docker/Unraid production runtimes.** The server banner-definition API no longer assumes the source `public/` tree exists inside the runtime image, and now falls back to the built `dist/CardBanners/Dark` directory that production containers actually ship with.
- **Grid/list banner presentation regressions, resolved.** Grid card banners now use the intended centered crop, banner-only cards keep a readable checkbox accent color, and mobile list views reserve enough bottom space for the last row to actually clear the floating action button.

## 1.5.1 - 2026-06-02

### Added
- **Note cards can now use banner artwork as a first-class visual surface.** Banner selection is available across the grid, editors, and card menus, with dedicated card/list asset contracts, localized labeling, and a distinct banner-picker icon path.

### Changed
- **Banner presentation is now collaborative and workspace-live instead of device-local.** Banner selection moved into shared note metadata, so editors and eligible collaborators see updates immediately across devices; legacy per-user banner preferences stick around as a fallback for older notes until explicitly touched.
- **Card, list, and detailed-list banner rendering now follow clearer appearance rules.** Users can choose whether titles render above or below banners (default: above), compact list views stay distraction-free without note chips, and drag previews follow the same reduced metadata treatment as everything else.
- **Bannered card visuals are now intentionally unified instead of an accident of layering.** When a banner is present, title readability, banner tinting, and the displayed card surface all derive from the same transformed banner palette, so header, media, and body stop fighting each other when a note color is also selected.

### Fixed
- **Warm startup and offline-first note recovery were flaky.** Startup hydration, render snapshots, offline banner preload, and cached workspace restores now reopen previously-loaded workspaces more consistently, without dropping saved notes or waiting on a full live refresh just to show something.
- **Banner and collaborator interactions regressed during offline or cold-start sessions.** Collaborator pickers can now surface immediately from cached state, banner selections hydrate earlier, and previously-loaded shared workspaces reopen faster with steadier live note state.
- **Reminder clears kept coming back after reloads or reconnects, zombie-style.** Local reminder caches and pending reminder mutations now correctly reconcile explicit clears, so stale reminders stop resurrecting themselves from cached or queued state.
- **Development startup used the wrong database migration path.** The server/db init flow now uses the corrected migration path during local startup, so `npm start` and friends don't silently miss recent schema changes.

## 1.5.0 - 2026-05-30

### Added
- **Workspace note moves now have a built-in trace workflow for live debugging.** Client and server move phases can be captured with `?moveDebug=1` and retrieved from `/api/debug/move-trace?traceId=...`, making collaborator/media follow-up failures much easier to diagnose without shipping a one-off logging patch every time something goes sideways.

### Changed
- **Card banner artwork now ships as SVG assets instead of PNGs.** Lighter to bundle, and better aligned with the rest of the app's vector-heavy offline asset pipeline.
- **Build and server diagnostics got more intentional by default.** Excalidraw font files are now served from `/fonts/*` in both dev and production builds, Prisma query logging is opt-in through `LOG_PRISMA_QUERIES=true`, and personal-workspace lookup now treats `PERSONAL` system workspaces as first-class user destinations.

### Fixed
- **Moving a note between workspaces didn't reliably preserve its full working state.** The optimistic/local move path now keeps docId-keyed image, link, collaborator, reminder, and note-order caches aligned with the new workspace, remaps collection and label IDs into the target workspace, and keeps attached drawing subdocuments on the same move path instead of orphaning them.
- **Interrupted note moves used to corrupt server state or fail with a false conflict.** The server move transaction now creates target document rows before repointing foreign-keyed child rows, reuses stale target note rows left behind by a partial move instead of choking on them, and keeps collaborator/share/media rows consistent as the source rows are retired.
- **Shared-note follow-through after a move was shaky for both owners and collaborators.** Media and collaborator refreshes now carry move trace IDs, stale shared-placement aliases no longer resolve to invalid doc IDs, retained workspace members get materialized into direct share rows during a move, and transient post-move 403/404 or empty responses no longer wipe out richer migrated caches before the server catches up.
- **A handful of startup and collaboration regressions uncovered during the move investigation, also fixed while we were in there.** Fresh login no longer trips the restored auth gate hook order, detached rich-text fragments no longer warn at startup, the drawing editor waits for Yjs awareness before binding collaboration, and note pin state resolves through the user-scoped pin preference store in note grids.

## 1.4.9 - 2026-05-25

### Changed
- **Shared With Me placements are now persisted in IndexedDB like the rest of the workspace shell**, instead of being the one thing that wasn't. The app keeps shared note placements per user and workspace in a dedicated local store, hydrates them before network refresh, and reuses that cache in Bubble View so Shared With Me and its subfolders stay on the same offline-first footing as everything else.

### Fixed
- **Shared With Me notes disappeared when the app went offline or reopened from local cache.** Placement refreshes now read through IndexedDB instead of falling back to an empty network result, so the Shared With Me workspace and its folders keep their visible notes while offline.
- **The About version badge didn't render offline in installed builds.** The version icon is now bundled like the rest of the About artwork, so the About screen stops falling back to a broken image placeholder when offline.

## 1.4.8 - 2026-05-24

### Changed
- **Desktop list and detailed-list views now use responsive multi-column layouts with matching drag previews.** Non-grouped list-like views split into contiguous desktop columns, preserve cross-column neighbor shifting during drag, and the drag ghost now mirrors the real row badges, trailing ellipsis action, and strip preview truncation instead of being a rough approximation.
- **Chip overlays now open with cleaner, production-safe motion and sizing.** Attachment and collaborator overlays clip their row reveals inside the card width, use a smoother wipe-in animation, and no longer force a wider shell than the originating chip row.

### Fixed
- **Returning from a list reorder to grid view broke masonry repacking.** List/strip drag commits now keep the new note order without leaking list-column anchor state into the masonry repacker, so grid mode stops inheriting long-short column imbalances after a reorder.
- **Mobile and installed-PWA text editing drifted the viewport upward while deleting content.** Rich-text updates stop forcing selection visibility on every keystroke, which was the actual cause of repeated backspace ratcheting the editor shell upward while the keyboard was open.
- **Offline and lazy-loaded production flows were less resilient than they should've been.** Shared-with-me workspace placements can now recover from cached sidebar state during startup, the drawing editor falls back cleanly if its lazy chunk is unavailable on first open, and the service worker falls back to precached app-shell assets and cached API/image responses more reliably when the network drops.

## 1.4.7 - 2026-05-24

### Fixed
- **Attachment chips and media panels drifted out of sync with live note state.** Note cards now surface attachment chips from current attachment totals instead of a stale snapshot count, and deleting an image from the media panel no longer leaves a ghost entry behind after a successful (but empty) refresh.
- **Attachment drawing flows didn't reliably reopen from note cards and browsers.** Attached drawings now use the overlay replacement path instead of a history race, and markdown task-item text on note cards opens the editor again instead of getting swallowed by the checkbox row.
- **Toolbar and media flows behaved inconsistently offline and on desktop.** Custom editor icons now render without a network dependency, the condensed toolbar keeps the scroll-to-bottom control, themed URL preview actions match the rest of the toolbar, and the desktop media sidebar stays open while the add-image modal is active.
- **Localization never quite reached the remaining drawing and search surfaces.** The mobile create-drawing FAB, note-grid scope label, and Excalidraw chrome now respect the active app locale (Spanish included) without the localized undo/redo integration crash.
- **Mobile search dismissal wasn't history-safe on Android.** The mobile search overlay now closes through the shared overlay-history path, so the Android back button dismisses search without desyncing the header state.
- **The image upload modal's camera capability typing didn't compile cleanly under TypeScript.** Zoom, torch, and focus-mode capability reads now keep their extended camera-track typing, and the camera launch button uses the correct click handler signature.

## 1.4.6 - 2026-05-24

### Fixed
- **Cross-column drag-and-drop finally feels identical to same-column reordering.** Destination columns respond to the live drag anchor (finger/pointer position) instead of the dragged card's rectangle, so notes with very different heights — like an expanded checklist card — no longer cause missed or skipped insertion points during a cross-column drag.
- **Column entry is now driven by where the pointer actually is**, which sounds obvious in hindsight. The dragged card stays in its source column until the pointer physically leaves it, then snaps to the destination column the moment the pointer enters it, with an edge-proximity fallback when the pointer's in a gap. No more dead zones from center-distance column selection.
- **A small viewport-edge visibility bias now stops mostly-offscreen destination cards from stealing the insertion slot** near the top or bottom of the scroll container.

## 1.4.5 - 2026-05-15

### Fixed
- **Production startup now uses the pinned Prisma 5 CLI instead of falling back to `npx` at runtime.** Database initialization invokes the local Prisma package directly, and the `prisma` package stays in production dependencies so `migrate deploy` keeps working after `npm prune --omit=dev`.

## 1.4.4 - 2026-05-15

### Fixed
- **Docker image builds were using a stale build cache to run a `npx prisma generate` step that no longer existed.** The Prisma CLI is now invoked directly from `node_modules/.bin` instead of via `npx`, preventing npm from downloading an incompatible newer version whenever the cache happened to be warm. Build cache export is now `mode=min` to avoid caching intermediate layers that can replay outdated commands.

## 1.4.3 - 2026-05-15

### Fixed
- **Docker image builds didn't complete reliably depending on cached layer state — a genuinely annoying one to chase.** The Prisma client is now generated before `npm prune` runs, so the local `prisma@5` CLI gets used instead of `npx` downloading the incompatible v7 release out of nowhere.

## 1.4.2 - 2026-05-15

### Changed
- **Collaborator chips now lead each note card's metadata row and keep avatar spacing visually even.** Single collaborators render as a centered filter avatar, small groups use a centered rotating avatar stack, and larger groups keep the existing count chip behavior.
- **Checklist editor controls behave more consistently across note and draft editors now.** Mobile toolbar actions, checkbox interactions, and icon rendering all follow the same paths in both editor surfaces instead of diverging.

### Fixed
- **Checklist cards were stretching, shifting, or leaving inconsistent completed-section spacing as previews settled.** Card height budgeting and completed-item layout now stay stable across desktop, mobile browsers, and installed PWA sessions.
- **Warm relaunches and dense list layouts showed a visible post-paint shuffle and scroll jitter.** Startup hydration and list-view sizing now settle without the shuffle that had crept into recent builds.
- **Mobile checklist interactions flickered the keyboard or showed mismatched checkbox visuals.** Toggle, delete, undo/redo, toolbar icons, and note-card checkbox styling now stay aligned with the actual editor state.

## 1.4.0 - 2026-05-12

### Added
- **Drawing workflows are now first-class across the app.** Freeman Notes ships a dedicated Excalidraw-based drawing editor, complete with canvas background presets, warm-start thumbnail caching, and support for bundled or drop-in custom drawing libraries.
- **Share and invite flows now remember who you actually work with.** Collaborator and invite dialogs can suggest prior collaborators, including cached identity and avatar details, for faster repeat sharing instead of retyping the same email every time.

### Changed
- **Mobile and installed-PWA behavior stays aligned with desktop more consistently now.** External navigation, editor layout, docked actions, and attachment flows all follow the same interaction model across desktop, mobile browsers, and installed app sessions.
- **Drawing cards and drawing browsers reopen faster and stay visually steadier.** Cached thumbnails, viewport-aware preview sizing, and drawing-specific rendering paths cut down on first-frame placeholder flashes and keep drawing-heavy workspaces stable instead of jittery.

### Fixed
- **Bubble and drawing-heavy note views were trying to render the entire workspace at once**, which is exactly as slow as it sounds. View virtualization and viewport-scoped rendering reduce DOM churn, improve workspace switches, and keep bubble layouts steadier while notes stream in.
- **New drawings now use explicit Save and Cancel actions, while existing drawings keep Done.** Prevents accidental dismissals during first-save flows without slowing down the faster existing-note edit path.
- **Drawing ink contrast didn't update immediately against the selected canvas background.** Auto-contrast defaults, live text editing, and selective recoloring of auto-ink elements now stay in sync before the user commits the element, instead of a beat behind.
- **Drawing note-card previews didn't keep the full drawing visible across devices.** Warm relaunches now recover cached previews sooner, and desktop/mobile cards stop clipping or mis-scaling the rendered thumbnail.

## 1.3.5 - 2026-05-05

### Changed
- **Shared-note workspace metadata now stays collaborator-scoped instead of leaking into the owner's canonical state.** Shared placements now carry per-collaborator collection and label state through the API and client overlays, so each collaborator can organize a shared note without mutating the owner's actual metadata out from under them.
- **Workspace note moves now preserve local note context across the optimistic move.** Local media, link, document, and collaborator caches now follow the moved doc id immediately, and moved notes remap collections and labels into the destination workspace instead of just dropping that metadata on the floor.

### Fixed
- **Refreshing the app reopened whichever modal or editor happened to be last visible.** Overlay restore now strips transient UI state and returns to the current workspace view after a hard refresh, instead of resurrecting whatever you were doing.
- **Shared-note collaboration broke after the owner moved a note to another workspace.** Shared-note aliases now reopen against the remapped room id, and move flows update the destination registries and collaborator metadata consistently instead of leaving them pointed at the old location.
- **Checklist cards were unstable as collapsed and completed rows rebalanced.** Checklist preview budgeting, completed-section sizing, and grid position layout now avoid the clipping and jumpiness that recent checklist cards had picked up.
- **Mobile and PWA image viewing felt rough at the edges.** The image viewer now clamps zoomed panning to image bounds, hands edge swipes off to previous/next navigation, and resolves the next image source immediately so first-pass swipes stop flashing the previous image.

## 1.3.4 - 2026-05-04

### Added
- **The Add Image camera modal now surfaces device zoom and rear-lens controls when the browser actually exposes them.** Camera capture can show offline-safe zoom controls and dedicated rear-lens chips, including ultrawide lenses when Android/WebView reports them as separate rear cameras.

### Changed
- **Filter chips and sidebar rows now preserve full names without forcing horizontal overflow.** Active scope chips use bounded marquee labels, sidebar collections compress deep ancestry into a readable second line, and workspace switcher rows wrap long workspace and owner names instead of just clipping them mid-word.
- **Checklist completion visuals are consistent across cards and editors now.** The shared rounded-square checkbox shell, larger checkmark glyph, and lighter strikethrough treatment now match between note cards and checklist editors.

### Fixed
- **List, detailed-list, and bubble views were rendering the full note set at once**, which does not scale. Window virtualization and viewport culling now reduce DOM work in list, strip, and bubble views, and workspace switches reset restored scroll state so virtualized layouts reopen from the correct viewport position instead of a random one.
- **Collection chips and deep collection trees were unreadable on mobile and in dense sidebars.** Collection metadata overlays now wrap path segments cleanly, expanded branches auto-scroll into view, and deep indentation no longer pushes nested collection names off-screen entirely.
- **Camera zoom changes knocked the live preview out of autofocus.** Zoom and torch updates now reapply focus-capable constraints together instead of overwriting the active camera track state mid-capture.

## 1.3.3 - 2026-05-04

### Added
- **Workspace render snapshots now seed the PWA shell before live docs hydrate.** Warm relaunches can restore note shells, preview rails, metadata chips, and per-view scroll positions from local snapshot state, so desktop and installed-PWA sessions reopen with visible structure immediately instead of a blank flash.

### Changed
- **Note colors are now fully user-scoped preferences instead of collaborator-visible doc state**, which is what they should have been from the start. Personal note color choices sync across a user's devices through the preferences API, while legacy shared color metadata sticks around as a read-only fallback during migration.
- **The header view switcher now opens an explicit anchored icon row.** Desktop, mobile, and installed-PWA layouts now expose direct card, list, detailed list, and bubble view selection instead of cycling blindly through modes.
- **Quick-create actions now show drawing placeholders alongside the iconized note and checklist actions.** Desktop top actions and mobile FAB menus are aligned for the upcoming drawing flow without exposing an unfinished editor early.

### Fixed
- **Reminder clears and updates didn't propagate across a user's active clients reliably.** Offline reminder mutations are now retried until they flush, explicit clears stay represented as `null`, and workspace metadata events refresh reminder badges after cross-client changes instead of leaving stale state around.
- **Desktop refreshes reopened the last edited note, and warm relaunches didn't recover cleanly after backend restarts.** Overlay restore logic now avoids reopening editor overlays on fine-pointer devices, and offline-restored sessions keep probing until the server is reachable again instead of giving up.
- **Checklist cards visually jumped when completed rows expanded on desktop.** Masonry columns freeze after the first settle, completed rows stay in normal card flow, and desktop checkboxes now match the editor's native control styling, so cards stop jumping or clipping their footer/link rails.

## 1.3.2 - 2026-05-03

### Changed
- **`NoteGrid` now virtualizes masonry columns independently instead of flattening the entire grid.** Each column keeps the DOM as the layout authority, card heights refresh from `ResizeObserver` updates, and drag sessions temporarily render full columns so drop previews stay accurate instead of guessing.
- **Docker publishing now follows semantic GHCR release rules automatically.** The GitHub Actions workflow publishes immutable `major.minor.patch`, `major.minor`, and `major` image tags from release tags, updates `latest` only from the highest release tag or `main`, and uses the repository `GITHUB_TOKEN` instead of a personal access token nobody wanted to manage.

### Fixed
- **Warm relaunches and workspace switches showed note hydration behind the splash screen**, which defeats the purpose of a splash screen. Startup and workspace readiness gates now rearm whenever the active workspace or view changes, and the splash only dismisses after the first stable viewport paint for the next grid.
- **Warm masonry restores left a small repack tail as note heights settled.** Visible card measurements now refresh incrementally from observed DOM height changes, keeping cached layouts and collaborator chip placement steadier during startup instead of visibly settling in front of you.

## 1.3.0 - 2026-04-24

### Added
- **Checklist rows can now become count items across editors, cards, and shared views.** Checklist items support an optional numeric prefix, with toolbar actions to create, increment, decrement, and remove count rows. The new count state flows through note editors, note cards, public shares, workspace image search text, and checklist data bindings.

### Changed
- **Startup hydration now seeds the app shell from local cache before React even finishes booting.** Device appearance, workspace list, note order, labels, collections, and reminder state are all hydrated up front, so workspace switches and app relaunches feel immediate instead of waiting on IndexedDB and network round-trips one after another.
- **Masonry layout now reuses viewport-aware local layout snapshots.** `NoteGrid` persists per-device column slots, rects, and note-order hints, so the first visible cards can render in stable positions sooner on warm launches instead of a fresh repack every time.
- **Network-sensitive image loading now prefers lightweight previews on poor connections.** Image viewers, note media panels, and workspace galleries now favor cached thumbnails and progressive previews sooner, and remote media requests plus push endpoints use explicit request timeouts instead of hanging indefinitely.
- **Workspace pickers and sidebar rows now surface owner context more clearly.** Shared workspace rows display owner identity more consistently in the sidebar and switcher UI, and collaborator invites reject duplicate identifiers before wasting a server round-trip on them.
- **Verified Vite builds now preserve nested build artifacts.** The shared Vite config no longer lets nested inject-manifest builds empty the outDir mid-build, matching the verified `dist-build-temp` publish flow.

### Fixed
- **Fresh and warm launches used to hold the splash screen until every note finished loading**, which felt like forever on a big workspace. The grid now dismisses startup loading as soon as the viewport-visible cards are loaded, measured, and stable, while still guarding against empty-card flashes during the first WebSocket sync.
- **Server dev shutdowns sometimes exited with code 1 for no discernible reason during reconnect-heavy sessions.** Graceful shutdown now terminates active WebSocket clients, closes lingering HTTP keep-alive connections, and logs uncaught synchronous exceptions instead of crashing silently and leaving you to guess why.
- **Pasted rich text squashed note-card previews down to nothing.** Multi-block clipboard HTML now falls back to the normal line-aligned preview clamp when block-boundary clamping would collapse the card to a single short paragraph.
- **iOS Safari and iOS installed PWA launches looked globally zoomed and cropped**, an unpleasant first impression. The app now applies locked viewport settings earlier for iOS Safari and stabilizes text autosizing, so the shell opens at the correct scale from the first frame.
- **Queued note-image previews didn't survive the handoff to the real uploaded image smoothly.** Successful uploads now promote the queued preview into the remote preview cache instead of dropping to a blank placeholder while metadata refresh catches up.
- **Image URL imports failed silently on invalid input instead of failing fast.** The Add Image flow now validates `http://` and `https://` URLs before enqueueing them, instead of queueing a job that was never going to work.

## 1.2.33 - 2026-04-20

### Fixed
- **Mobile sidebar close interactions were janky, not smooth.** Closing the drawer from a drag no longer causes the panel to jump left and snap back under your finger before the gesture even finishes.
- **Mobile sidebar reopen behavior broke after tap-away close.** Dismissing the drawer by tapping outside it no longer leaves the FAB and sidebar state out of sync — the sidebar button and edge-swipe opener work again on the next interaction instead of needing a page reload.

## 1.2.32 - 2026-04-20

### Fixed
- **Docker image builds failed during `npm ci` postinstall.** The build stage now copies `scripts/prisma-generate-if-needed.cjs` before `npm ci`, so the install-time Prisma generate hook actually exists when npm runs `postinstall` inside the container instead of erroring on a missing file.

### Changed
- **Debug build artifact folders were being shipped in git**, which they absolutely should not have been. The tracked `dist-notegrid-debug`, `dist-notegrid-quiescence`, `dist-runtime-debug`, and `dist-sidebar-swipe-fix` directories were removed from the repository so release commits only carry source and intentional assets.
- **Ignore and Docker context rules now exclude local debug build output.** `.gitignore` now ignores `dist-*`, and `.dockerignore` excludes `dist-*` and `.venv`, so local troubleshooting output stops leaking into future commits or Docker build contexts.

## 1.2.31 - 2026-04-20

### Fixed
- **Default production builds could break `/` mid-deploy.** `npm run build` now compiles into a temporary output directory, verifies the result contains a complete app shell, and only then swaps it into `dist`. This stops partially-written frontend assets from breaking `/` while the Node server and health checks still appear perfectly healthy — the worst kind of failure, the silent kind.
- **Windows build publishing choked on file-lock rename failures.** The release build wrapper now retries transient filesystem errors and falls back to copy-and-delete when Windows refuses a directory rename with `EPERM`/`EBUSY`, so the verified build still lands in `dist` instead of just giving up.
- **Mobile sidebar edge-swipe open didn't work immediately after a fresh login.** The open-gesture listener now stays mounted for the full mobile session and reads auth, grid, editor, selection, and sidebar state through live refs instead of a stale closure captured during initial app bootstrap.

### Changed
- **Deployment and install templates now match the current runtime configuration.** Docker Compose, `.env.example`, `.env.docker.example`, `DEPLOYMENT.md`, the README install sections, and the Unraid template were refreshed to document the current auth, notification, cleanup, Redis, and OCR variables, including the workspace-cleanup controls and release image tag references.

## 1.2.30 - 2026-04-19

### Fixed
- **Android standalone/offline note editor reopened at the wrong height after Add Image flows.** The fullscreen editor overlay could retain a latent scroll offset after nested modal transitions, effectively shifting the editor off-screen on the next open. The mobile editor shell now derives its height from the live Visual Viewport, and the fullscreen overlay aggressively resets its own scroll position on mount, so reopen/dismiss cycles use the real visible viewport instead of a stale one.

### Changed
- **Temporary Android editor tracing was removed after the fix was verified.** The one-off modal/scroll diagnostics added during investigation got stripped back out, so the production bundle only keeps the actual viewport/overlay fix and none of the scaffolding.

## 1.2.28 - 2026-04-16

### Fixed
- **Bubble view: score-driven size changes and repacking used to snap instead of animate.** When a note's importance score increased (just edited, pinned, given a reminder), the bubble previously snapped to its new size and position almost instantly (240ms) — jarring. CSS transitions on `.cloudItem` are now lengthened to 640ms (smooth ease-in-out) for size and 820ms (gentle spring overshoot) for position, giving bubbles a physics-like quality where they gently inflate/deflate and drift into place instead of teleporting.
- **Bubble view: bubbles snapped instead of shrinking smoothly.** The bubble's inner circle is sized via `width: min(100%, var(--bv-bubble-diameter))`. When the diameter variable decreased, `min()` resolved instantly — the px value dropped below `100%` while the container was still mid-transition, producing an immediate visual shrink before the container caught up. A matching `width 640ms` transition on `.bubble` now keeps the inner circle tracking the container on both grow and shrink.
- **Bubble view: repacking after zoom-slider changes felt stiff instead of fluid.** Because each new slider position starts a fresh 820ms transition from the current interpolated position (not the old settled one), bubbles now drift through the cloud like they're suspended in liquid, rather than snapping to each new packing solution one at a time.
- **Bubble view: active workspace bubbles took a beat to appear when switching to Bubble view.** The component used to load every workspace's IDB data (one 4-second timeout per inactive workspace) before calling `setNotes` even once, so the cloud stayed blank until every workspace finished. Active workspace notes now emit immediately (already in memory), and each inactive workspace streams its notes into state as soon as its own IDB load completes.
- **Bubble view: bubbles now enter with a natural staggered drift instead of arriving all at once.** Entrance animations slowed (spring stiffness 180/damping 18 vs. 260/22) and staggered by 28ms per bubble in score-sorted order, so the most important bubbles appear first and smaller ones drift in behind them.
- **Concurrent offline edits to checklist items were concatenating into gibberish.** When two users each deleted and retyped the full content of the same checklist item while offline, Yjs CRDT merged their character-level edits into one mashed-together item (e.g. "breadCream" — not what either of them typed). The fix adds a ProseMirror `appendTransaction` plugin to `MobileSafeTaskItem` that detects "full-content replacement" transactions — any `ReplaceStep` whose range spans the entire text of an item's own paragraph — and converts the operation from a text-level edit into a node-level replacement: the original `Y.XmlElement` is tombstoned and a fresh element with a new UUID is inserted instead. On CRDT merge, both users' old elements get tombstoned (agreement) while each new element carries a distinct Yjs clock identity, so they coexist as two separate list items instead of merging into word soup. Covers select-all-then-type, paste-over-selection, and the final backspace that empties an item.
- **Header connection scan line restarted before reaching the full width.** The traveling highlight on the restored thin-line connection indicator now completes its sweep across the full line before looping, instead of cutting itself off early.

## 1.2.27 - 2026-04-15

### Fixed
- **Note cards were forced to a fixed height regardless of content — not the dynamic-height behavior anyone wanted.** The v1.2.26 `min-height` rule made every card fill the full configured height no matter how short the content was, leaving short notes with a big empty void and preventing cards from ever being shorter than the configured cap. The `min-height` rule is gone; cards resize freely to their content again, with `max-height` as the only ceiling.
- **Changing the Note Card Height preference didn't correctly apply to all workspaces.** Every time any preference slider moved, `persistDevicePrefsLocally`'s `useCallback` captured all current pref-state values in its dep array — meaning `syncLocalDevicePrefsFromServer` got a fresh function identity on every single slider tick. Because that function sat in the prefs-hydration `useEffect`'s dependencies, the whole effect re-fired on every slider movement, triggering a fresh `fetchUserPreferences` network call that raced back with the stale server value and overwrote the in-flight local change. The stable-ref pattern already used by `refreshActiveWorkspaceRef` is now applied to both `syncLocalDevicePrefsFromServer` and `persistDevicePrefsLocally`; the effect's dep array is trimmed to true auth-state deps only (`authStatus`, `authUserId`, `deviceId`, `authOfflineMode`, `setLocale`), so it stops re-firing for no reason.
- **Changing the Note Card Height preference didn't correctly rebalance masonry columns.** When the max-card-height cap changed (moving the height slider in Preferences), previously-measured card heights cached in memory stayed pinned at the old cap. The masonry column-distribution algorithm kept using those stale heights, leaving columns unbalanced until a workspace switch or full reload jarred it loose. `NoteGrid` now clears its in-memory height cache and triggers a fresh measurement pass whenever `maxCardHeightPx` changes, so masonry rebalances immediately at the correct heights instead of waiting to be asked twice.

## 1.2.26 - 2026-04-15

### Fixed
- **Note cards weren't rendering at a consistent height in the grid.** Cards previously rendered at their natural content height (often tiny for short notes) with no lower bound. A `min-height: var(--note-card-max-height)` rule was added so every card fills the configured height regardless of content length — making the Note Card Height setting actually visible across every workspace and note length. (This rule got reverted one version later in 1.2.27 once it turned out to overcorrect — see above. Software.)
- **Default card height and font scale weren't device-aware for new devices.** On first login from a fresh device (detected by the absence of a saved card height in the server record), mobile devices (coarse-pointer) now default to 480px card height, 75% note-card font scale, and 80% editor font scale; desktop defaults to 920px and 100% scales. Defaults are pushed to the server immediately so they persist across future logins.
- **Minimum font scale was stuck at 75%.** The Display Size slider in Settings now allows scaling down to 60%, for anyone whose display environment needs it.
- **Collaborator modal avatars showed the broken-image browser icon instead of falling back to initials.** All four avatar rows (invitee, current user, note owner, collaborators) now use a `MemberAvatar` component that tracks image-load errors and renders letter-initial fallback when the image is unavailable — e.g. an offline SW cache miss.

### Fixed
- **Fresh-login skeleton cards jumped the instant WS content arrived.** On a first visit (empty IndexedDB), the docs-loaded check finished almost instantly because IDB sync resolves immediately for empty stores. The shimmer disappeared while the WS server was still delivering note content, so card heights visibly shifted as real data populated behind it. `DocumentManager` now tracks a `registryWsSynced` flag that only flips `true` after the notes-registry WebSocket room fires its first full sync; `NoteGrid` holds `allDocsLoaded = false` (keeping the shimmer up) until that flag is set, so the grid measures real content heights before it reveals anything.
- **Pending-invitation rows in the Collaborators modal didn't show the invitee's avatar.** The server's `mapInvitation` function included the invitee's Prisma record in its DB select but never actually exposed the `id` field in the API response. Without `inviteeId`, the client had nothing to look up the cached avatar with. `inviteeId` is now included in the server response, stored in the collaborator IDB cache, and used as a fallback in `CollaboratorModal` via `getCachedAvatarUrl`.

### Fixed
- **Note card shimmer failed to suppress correctly across PWA re-opens.** The seen-workspace registry lived in `sessionStorage`, which iOS/Android happily clears whenever the app is terminated. Now stored in `localStorage`, so the "skip shimmer on warm IDB" logic works after every app relaunch, not just in-session refreshes.
- **Pending sync icon appeared even while editing online — misleading, since nothing was actually pending.** On every workspace switch, `DocumentManager` discarded WS providers but kept the per-doc `onAfterTransaction` listeners alive. Those stale closures held onto a reference to the destroyed WS provider, whose `wsconnected` reads `undefined` (falsy), so any subsequent edit triggered the 3-second debounce and showed a false pending-sync badge for no reason. `docCleanup` now runs alongside `wsCleanup` during workspace transitions, so handlers get correctly removed and re-attached when the workspace is revisited.
- **Connection indicator flashed "connecting" on every workspace switch**, which got old fast. Header icon transitions to the connecting state are now debounced by 600ms; workspace switches that complete their WS reconnect faster than that (the typical case) never become visible to the user at all.
- **Accepted personal-workspace shared notes took ~30 seconds to appear instead of under 2.** After accepting a share into a personal workspace, the WS provider for the new room connects immediately — but the server may not have committed collaborator permissions to its WS session store yet. A 1.5-second delayed `reconnectAllProviders` call now bridges that gap, instead of making you wait out the full 30-second `resyncInterval`.
- **Collaborator avatar images weren't cached by the service worker when first seen.** `updateAvatarCache` now fires a fire-and-forget `fetch` for each new same-origin avatar URL while online. The service worker intercepts the request and stores the image in `freemannotes-images-v2`, so it's served from cache on the next offline session instead of just being a broken box.

### Fixed
- **PWA re-open re-showed the shimmer/skeleton animation on a perfectly warm cache.** `seenWorkspaceIdsRef` was never populated after the grid was ready, so `suppressShimmer` was permanently `false`. The ref is now initialized from `sessionStorage` on mount and written to `sessionStorage` in the `onReady` callback, so workspaces already loaded this session skip the skeleton animation entirely instead of replaying it pointlessly.
- **Sync-pending icon flashed during brief reconnects that were never actually a real disconnect.** When the app returns to the foreground it force-reconnects WebSocket providers; any in-flight edits briefly set a pending-sync badge even when connectivity was never actually lost. A 3-second debounce in `DocumentManager` now delays the badge until the reconnect window has genuinely passed, eliminating the false flash on fast reconnects.
- **Accepting a note share into a personal workspace just... didn't work.** `handleAcceptedSharedPlacement` was returning early for `target === 'personal'` acceptances, silently dropping them on the floor. It now switches to the target workspace (if needed) and refreshes placements, so accepted notes actually show up in the grid. `visibleSharedPlacements` also now returns active-workspace placements for non-Shared-With-Me workspaces instead of always returning an empty array.
- **Inviter avatars went blank after an offline session.** User profile-image URLs from the note-share API are now stored in a lightweight `localStorage` cache (`freemannotes.userAvatarCache.v1`). The Notifications modal falls back to the cached URL when the live one is unavailable, so inviter chips stop going blank the second connectivity drops.

### Fixed
- **Bubble-click on Shared With Me notes stopped opening the editor correctly.** The v1.2.21 fix for keeping shared notes out of every workspace used an approach (splitting state) that broke placement lookups when clicking a bubble — a fix that fixed one thing and broke another. The fix now lives in `visibleSharedPlacements` instead: it returns an empty array when the active workspace isn't Shared With Me, so `NoteGrid` never injects shared alias IDs into other workspace grids in the first place. `sharedPlacements` keeps holding all placements from every SHARED_WITH_ME workspace, so bubble-click lookups, cross-workspace modal resolution, and room-alias registration all stay fully intact.

## 1.2.21 - 2026-04-15

### Fixed
- **Shared With Me notes were appearing in every workspace**, which defeats the whole point of having workspaces. Fetching placements from all SHARED_WITH_ME workspaces (needed for bubble-view alias resolution) was inadvertently storing them all in state, so the NoteGrid showed shared notes regardless of which workspace was actually active. Extra-workspace placements now live in a ref used only for room-alias registration, while `sharedPlacements` state (which actually drives the NoteGrid) stays limited to the active workspace.
- **Clearing failed link-preview notifications didn't persist and didn't update the badge.** Clicking "Clear notifications" when only URL-preview failures were present removed the rows on screen but left the bell badge count unchanged — and the items would just reappear on the next metadata refresh, like they'd never left. Dismissed failure IDs are now saved to `localStorage` and filtered out on every subsequent `refreshNoteShareState` call, with the badge count decremented immediately on dismiss.

## 1.2.20 - 2026-04-14

### Changed
- **Condensed toolbar toggle buttons are now icons instead of pill-shaped text labels.** "Headings", "Lists", "Insert", "Layout", "Copy" got replaced with compact icon buttons for a cleaner, more space-efficient layout. A new Formatting group (B icon) exposes Bold, Italic, Underline, Strikethrough, Link, Highlight, and Scroll-to-bottom — previously always visible in the primary row whether you wanted them there or not. Sub-toolbar action buttons are slightly larger in condensed mode than the full toolbar for better tap targets on mobile.

## 1.2.19 - 2026-04-14

### Fixed
- **"Clear notifications" was permanently disabled whenever the only items present were failed link-preview fetches.** Failed link-preview notifications are now included in `canClearNotifications`, and a new `onClearFailedLinks` callback actually clears them from app state on dismiss.
- **Bubble view didn't open notes from non-active "Shared with me" workspaces.** Clicking a bubble belonging to a workspace other than the currently active one failed silently for shared-note placements, because their Yjs room IDs were never registered. `refreshNoteShareState` now fetches placements for every SHARED_WITH_ME workspace (not just the active one) and registers them all in `setExternalRoomAliases`, so the cross-workspace note modal resolves the correct room and sub-folder notes actually work too.

### Changed
- **Debug overlay and debug console removed from the production build**, where they never should have shipped. The "DBG" pill, event-log overlay, and per-component mount/unmount tracking added during Android camera lifecycle debugging have been stripped from `App.tsx`, `NoteEditor.tsx`, and `NoteImageUploadModal.tsx`. No user-visible or functional change — just less clutter in the bundle.
- **Verbose WebSocket connection logging removed from the server.** The `[ws-debug] open` and `[ws-debug] close` lines that logged every Yjs WebSocket connection to the npm console are gone from `server.js`.

## 1.2.18 - 2026-04-12

### Added
- **Editors now support strikethrough and a per-device condensed toolbar mode.** Rich-text note editors expose strikethrough in the full, minimal, and selection bubble toolbars, and Preferences now lets each device choose between the full toolbar and a grouped condensed one.

### Changed
- **Checklist cards and note previews fit their space more cleanly now.** Checklist cards budget space for active and completed items without inner-scroll traps, recently completed rows stay visible first, and text cards only apply a fade/clamp when the body actually overflows instead of preemptively.

### Fixed
- **Bubble and cross-workspace ghost notes rendered even when they shouldn't have.** Bubble loading and cross-workspace hydration now treat empty title/body/checklist docs as stale ghost entries and close missing-note views cleanly instead of showing a broken placeholder and hoping nobody notices.
- **Android/PWA back navigation didn't restore the notes view from Images and Trash.** Special mobile sidebar views now reuse the sidebar history entry they were opened from, so Back returns directly to the previous notes list instead of reopening the sidebar or, worse, exiting the app entirely.

### Changed
- **Photo-upload modal behavior was hardened for Android and mobile testing.** The Add Image flow now includes stricter interaction shielding around Android camera return events, stronger on-submit filename checks across queued and stored note images, keyboard-dismiss timing adjustments when renaming before submit, and a fixed footer action area so the Add Photo button stays visible while the file list scrolls underneath it.

## 1.2.17 - 2026-04-11

### Added
- **Admins can now issue direct registration invites from preferences.** Global admins get a dedicated Send Invite flow that emails a one-time registration link for a specific address, even when public registration is turned off.

### Changed
- **Authenticated startup applies the user theme earlier.** Theme bootstrap now prefers the signed-in user's cached or freshly-fetched preference before workspace activation, so the first authenticated note load uses the right appearance sooner instead of flashing the default first.

### Fixed
- **Cold-login note grids reshuffled visibly as card data hydrated in.** Placeholder cards, first-pass masonry packing, and ready-state handoff now share the same fallback height model, so a clean browser login stays visually stable instead of jumping around while it figures itself out.
- **Auth sessions weren't as resilient across normal long-term use as they should've been.** Successful `/api/auth/me` checks now refresh finite session cookies as a rolling window instead of letting them expire on a fixed schedule, and the service worker no longer caches auth probes or any API response marked `Cache-Control: no-store` — which was the actual source of the stale-auth state that used to force some users to clear their browser cache just to log back in.

## 1.2.16 - 2026-04-11

### Added
- **Shared workspace owner context is easier to inspect now.** Foreign workspace avatar chips now open an inline owner card in the sidebar, and the workspace cache/API path carries the owner metadata needed to keep that identity visible across refreshes.
- **Cross-workspace bubble notes now expose the same note actions when permissions allow.** The standalone bubble note modal can hand off collaborator, reminder, attachment, collection, and label actions without switching the active workspace, while still respecting read-only roles.

### Changed
- **Highlighting and mobile checklist editing got more usable.** The rich-text toolbar now includes a default highlight swatch plus lime/cyan/rose options, unstyled highlights render consistently in note previews, and checklist checkbox undo/redo moved from the mobile keyboard toolbar into contextual controls beside the media handle.
- **Android standalone PWA chrome is more consistent with the active theme.** Installed Android launches now apply the stricter viewport and theme-color handling needed to keep the background and system navigation bar aligned with the app surface instead of looking like two different apps stitched together.

### Fixed
- **Mobile chip dropdowns drifted right on left-column note cards.** Collaborator, metadata, and attachment menus now clamp to the same 4px edge margin the mobile grid already uses.
- **Opening note collaborators scrolled the notes grid to the top for no reason.** Root scroll locking now captures and restores the real document scroll position when modals open and close.
- **Mobile note-card more menus leaked taps through or dismissed awkwardly.** The sheet now keeps the opening gesture guarded, adds an explicit close button, and supports a dedicated swipe-down handle without accidentally activating the note underneath it.

## 1.2.15 - 2026-04-10

### Added
- **Personal workspace is now canonically identified in the database**, instead of inferred by pattern-matching a UUID in the name like some kind of regex archaeology. A new `PERSONAL` value in the `WorkspaceSystemKind` enum replaces the legacy heuristic. New registrations receive `systemKind = PERSONAL` at creation; existing workspaces are backfilled by migration. The name-pattern fallback sticks around for any rows that predate the migration.
- **Workspace list now includes owner name and profile image for foreign workspaces.** Shared workspaces carry `ownerName` and `ownerProfileImage` in the API response, so the UI can tell apart identically-named workspaces from different owners.
- **Note-share invitations now carry the invitee's profile image.** The collaborator and invitation payload includes the invitee avatar alongside the inviter's, enabling richer accept/decline UI.
- **Granular note-card interaction preferences.** Three new per-device toggles — `noteCardCheckboxInteractions`, `noteCardLinkInteractions`, `noteCardCompletedInteractions` — give fine-grained control over checkbox tapping, link opening, and completed-item collapse directly on note cards. The existing `noteCardClickOpens` flag still acts as a master toggle that sets all three at once.

### Fixed
- **VIEWER-role collaborators couldn't sync Yjs rooms or use the editor at all.** The Yjs WebSocket handler was closing connections on `messageYjsSyncStep2` for read-only clients. `SyncStep2` is the client's *required handshake reply* to the server's own `SyncStep1` — closing on it created an infinite reconnect loop, which manifested as a perpetually flashing connection indicator, a locked/unusable editor, and continuous Prisma query spam on the server. Not a great first impression for a read-only user.
- **The collaborator-sync effect was re-running on every single Yjs connection state change**, way more than necessary. `NoteGrid`'s collaborator-sync `useEffect` depended on a `new Set(...)` that gets a fresh object reference on every `DocumentManager` snapshot emission, even when the pending note IDs hadn't actually changed. The dependency is now a stable `string` signature, eliminating spurious database queries every time the WebSocket transitioned between `connecting`, `synced`, and `offline`.
- **Note-share revoke didn't notify all source-workspace members.** `onWorkspaceMetadataChanged` on collaborator revoke now includes every workspace member of the note's source workspace, so open collaborator lists on any connected device converge immediately instead of drifting out of sync.
- **Gateway errors (502/503/504) during sharing operations used to just fail outright instead of queueing offline.** Share link generation (`ensureNoteShareLink`, `ensureWorkspaceShareLink`), workspace invite removal (`removeWorkspaceMemberAccess`), workspace creation, and collaborator role/revoke operations all now catch 502/503/504 responses and fall back to the offline queue like everything else does.
- **`WS metadata debounce` now prevents Prisma query bursts on note-share events.** Note-share WS events now debounce both `refreshNoteShareState` and `bumpCollaborationRefreshToken` together (300ms), so a burst of N events produces one pair of calls instead of N × DB queries hammering the database for no reason.

### Infrastructure
- **PostgreSQL enum split migration pattern, learned the hard way.** `ALTER TYPE ... ADD VALUE` only commits the new enum value when its enclosing transaction ends; any `UPDATE` referencing the new value in the *same* transaction fails with error 55P04. The `20260412000000_personal_workspace_kind` migration now contains only the `ALTER TYPE`; the backfill `UPDATE` runs in a separate migration, `20260412000001_personal_workspace_kind_backfill`.

### Debug instrumentation (development only)
- Server logs `[ws-debug] open/close room=… readOnly=… code=…` for every Yjs WS connection, so a rapid reconnect loop becomes immediately visible in the server terminal instead of a mystery.
- Browser console emits `[collab-debug]` when `bumpCollaborationRefreshToken` gets called more than 3 times in 2 seconds.
- Browser console emits `[ws-meta-debug]` when more than 10 metadata WS messages arrive in 2 seconds.
- Browser console emits `[collab-sync]` listing which dep changed each time the NoteGrid collaborator-sync effect fires.

## 1.2.14 - 2026-04-09

### Added
- **Workspace bubble colors are now user-customizable and theme-aware.** Each workspace can get a personal semantic bubble color that persists per user, syncs across sessions/devices, and resolves into light/medium/dark theme-adaptive shades instead of storing a raw hex value that'd look wrong the moment you switched themes.
- **Cross-workspace bubble opens now mount a dedicated standalone editor.** Tapping a bubble from another workspace opens that note directly without switching the active workspace, using a dedicated modal/editor hydration path that reuses the background-cached Yjs room.

### Changed
- **Bubble importance now spans a much wider size and placement range.** Bubble sizing uses a broader diameter ladder, a stronger freshness curve, a tighter title-growth cap, and rank-aware vertical packing, so important notes float noticeably higher while stale notes sink lower, more consistently across desktop and mobile.
- **Bubble zoom now scales by viewport.** Desktop keeps its existing 100% zoom feel, while mobile/PWA uses a flatter upper zoom curve, so the same slider value stays practical on a narrow screen instead of maxing out uselessly fast.

### Fixed
- **Workspace bubble color overrides didn't survive a refresh and didn't sync live to other sessions.** Preference fetch/save responses now always include bubble color overrides, discrete picker actions flush immediately, and a user-preferences WebSocket metadata event triggers other sessions to refresh without stomping on local changes.
- **Bubble workspace color picking was unreliable and clunky.** Picker outside-click handling no longer swallows swatch clicks, the palette now offers a broader mix of light/medium/dark families, and the portal-based picker stays within view without button-like borders or clipping off the edge.
- **Cross-workspace note opening flashed a malformed nested mobile layout for a moment.** The modal now delays its loading state slightly and shows only a lightweight loading shell while IndexedDB/websocket hydration settles, avoiding the transient fullscreen editor glitch that used to show up first.

## 1.2.13 - 2026-04-09

### Fixed
- **Workspace deletion left the connection indicator stuck permanently red.** On fast or local connections, the server's metadata WebSocket echo could arrive and get processed by the browser *before* the `fetch` Promise for the DELETE request even resolved — a race that caused `clearActiveWorkspaceState` to disable WebSocket sync before the new workspace's providers were set up. The fix registers a suppression guard *before* the HTTP request is sent (`onBeforeWorkspaceDelete`), adds a synchronous workspace-ID check via `DocumentManager.getActiveWorkspaceId()` as a reliable fallback, and explicitly re-enables WebSocket sync in `handleWorkspaceDeleted` as a recovery safety valve for whatever slips through anyway.

## 1.2.12 - 2026-04-09

### Added
- **Multi-color text highlighting in the rich-text editor.** The TipTap toolbar now includes a highlight button that opens an 8-color swatch picker (yellow, green, blue, pink, purple, orange, teal, red). Colors are stored as CSS variables and adapt to the active theme.
- **Emoji picker in the rich-text toolbar.** A quick-access emoji grid (48 emojis, no external dependency) is available directly in the TipTap toolbar for all rich-text note types.
- **Checklist undo/redo.** Both the new-note (`ChecklistEditor`) and existing-note (`NoteEditor`) checklist editors now support undoing and redoing check/uncheck actions via toolbar buttons and the standard `Ctrl+Z`/`Ctrl+Shift+Z` shortcuts.

### Fixed
- **Highlight colors weren't rendering in note card and list views**, only in the editor. The rich-text preview renderer in note cards and the detailed list view now handles the `highlight` mark and renders the stored color, matching the in-editor appearance instead of just dropping it.
- **Checklist undo/redo toolbar buttons were the wrong size and didn't adapt to theme.** The icons now use the same CSS `mask-image` technique as other toolbar icons, so they scale correctly at 16×16 and inherit the current theme color like everything else does.

### Added
- **Sidebar label management is now available outside note editing.** The sidebar now includes a dedicated `Manage labels...` entry, and the labels modal can switch into a standalone management mode with focused side-pane editing on mobile.
- **Pending note-share invites can now be cancelled.** Owners can revoke queued or server-persisted note-share invitations, and share notification panels now refresh live when invitation metadata changes elsewhere.

### Changed
- **Backend route edits now hot-reload in development.** The dev server script runs `node --watch server.js` after database init, so server-side fixes no longer require a manual restart every single time.
- **Reminder and test delivery now resolve against the originating device.** Test notifications and reminder fallbacks now target the current device registration before deciding whether email should be used instead of guessing.

### Fixed
- **Mobile and installed iOS PWA scrolling was flaky.** Mobile sidebar scrolling, short-editor auto-scroll, and the installed iOS quick-create FAB now stay anchored without pull-down drift.
- **Notification branding and fallback diagnostics were unclear.** Push notifications now use dedicated app icon/badge assets, and failed email fallback attempts now surface the actual SMTP transport error in the test UI instead of a vague failure.
- **Metadata management layouts overflowed on narrow screens.** Collection tree rows and the labels management layout now stay within the modal width while keeping edit controls reachable.

## 1.2.10 - 2026-04-07

### Added
- **Collection and label management is now inline and self-validating.** The Add to collection, Manage collections, and Add labels flows now support in-place create and rename actions, duplicate-name validation, and richer label color selection with preset swatches plus a custom picker.

### Changed
- **Note actions and metadata chips are more consistent across cards and editors now.** Collection chip menus show themed folder rows with compact nested paths, attachment counts use the note accent color, note editors expose pin and bulk checklist actions in the more menu, and link/image additions surface the same brief confirmation feedback in editors and attachment browsers.
- **Collection trees and label tools got more usable on mobile.** Collection modals now use their full height, support horizontal scrolling for deeply nested trees, and the custom label color picker opens in its own anchored container instead of shifting modal content around underneath you.

### Fixed
- **Chip overlays leaked taps through to note cards behind them.** Collaborator, metadata, and attachment chip menus now suppress ghost taps and close cleanly without opening the underlying note on touch devices.
- **Android back didn't close the Add to collection modal.** Coarse-pointer devices now push a temporary history entry, so the system back gesture dismisses the modal first instead of exiting the app or doing nothing.
- **Checklist and list interactions didn't settle cleanly after touch edits.** Expanded completed-item sections can now hand scrolling back to the page, list and strip reorders use a shorter settle window, and touch reorder cleanup now avoids accidentally opening the note right after a drop.

## 1.2.0 - 2026-04-06

### Added
- **First beta release baseline.** Freeman Notes now ships with a release-aligned Docker Compose stack, refreshed deployment docs, and an updated Unraid template, so the packaged deployment story actually matches how the app behaves.
- **Richer reminder delivery.** Reminder notifications and reminder emails now include note context, workspace context, and preview text, with a browser-viewable reminder email preview added under `scripts/reminder-email-preview.html`.

### Changed
- **Reminder delivery now prefers clearer branding and fallback behavior.** User-facing reminder/test delivery uses `Freeman Notes` branding, app-icon-based notification assets, and clearer notification-state copy when email fallback is active.
- **Sidebar organization is simpler now.** Reminder shortcuts, quick filters, grouping, and sort controls all have scoped clear actions, cleaner labels, and grouped rendering parity across card, list, strip, image-gallery, and bubble-derived reminder views.
- **Editor title fields and quick-create flows are more resilient.** New-note editing preserves metadata-aware drafts more reliably, uses autosizing title fields, and keeps checklist keyboard navigation/focus behavior consistent across editor surfaces.

### Fixed
- **Auto notification mode didn't fall back to email when push was unavailable or unregistered.** Server-side policy checks and client messaging now agree on when SMTP should kick in, instead of silently dropping reminder delivery on the floor.
- **Reminder-driven filtering used stale local metadata instead of the actual source of truth.** Note grid, image gallery, bubble view, and reminder modals now resolve reminder timestamps through synced reminder state.
- **Desktop sidebar scrolling felt heavier than it needed to.** Desktop sidebars now use the same minimal scrollbar treatment already used in note-card completed-item lists, while mobile keeps its existing hidden-scrollbar behavior.

## 1.1.43 - 2026-04-06

### Changed
- **Note-card chip dropdowns now share one card-aligned layout.** Label, collaborator, collection, and attachment chip menus use the full note-card width and stay horizontally centered on the card, instead of drifting based on whichever chip button happened to open them.

### Fixed
- **Chip dropdown vertical placement didn't actually follow the chip row.** The first pass at card-width anchoring used the full card rect for vertical placement too, so menus could appear way below the whole card or way too far above it. The anchor logic now keeps card-based width/centering but uses the actual chip trigger for the above/below flip, so menus open directly under the chip row when there's room and directly above it when there isn't.
- **Chip dropdown animations were janky and inconsistent.** All note-card chip menus now use a lighter, slightly faster stagger with reduced bounce and no height-jitter between rows.

## 1.1.42 - 2026-04-06

### Added
- **New notes are now hidden from the grid and Bubble View until they're actually saved.** Creating a note/checklist no longer flashes an empty card into the note grid or an extra bubble into Bubble View before there's anything in it. The note only appears once the editor closes with content — cancelling an empty note leaves the UI completely untouched, like it never happened.
- **Cancel always shows an X on new notes now.** The editor close button always displays a discard icon (✕) while composing a brand-new note, regardless of whether anything's been typed yet. Previously the button could flip to a save-checkmark in Bubble View, incorrectly implying the empty note would actually get saved.

### Fixed
- **403 errors fired just from opening the editor in Bubble View.** Creating a note while in Bubble View was triggering immediate API calls for media, documents, links, and share collaborators on a note that hadn't synced to the server yet — a request for permissions on something that didn't exist server-side. The draft note ID now registers before any async IDB/network work begins, so NoteGrid and BubbleView filter it out and attachment chips never mount during the creation window.
- **Bubble View widths were measured wrong on first render and after resize.** The previous `useEffect([], [])` ResizeObserver registration was a no-op when notes weren't loaded yet (the cloud div hadn't mounted). Replaced with a callback ref that attaches the ResizeObserver the moment the container actually appears in the DOM. The initial width estimate also correctly omits the sidebar on narrow/mobile viewports now.

## 1.1.41 - 2026-04-05

### Changed
- **Rich-text nesting controls now work consistently across toolbar, keyboard, and mobile editors.** The full editor toolbar exposes nest/outdent actions beside blockquote, mobile and PWA editor toolbars surface the same controls when list or quote nesting is active, and `Tab`/`Shift+Tab` follow the same structured nesting rules everywhere.
- **Android standalone chrome now picks up the app theme earlier and more reliably.** Theme bootstrap runs before React mounts, the root element background syncs alongside `body`, and the generated PWA manifest defaults to the app background instead of a jarring white fallback.

### Fixed
- **The mobile User Management Reset Password button didn't fit its text without changing width.** The label now wraps as a controlled two-line button on small screens with slightly smaller control text, instead of overflowing.
- **iOS PWA quick-create controls ignored safe areas and only blurred part of the app.** The FAB and its action stack now offset against safe-area insets, and the quick-create backdrop sits above the full shell, so opening it blurs the entire viewport like it should.

## 1.1.40 - 2026-04-05

### Changed
- **Checklist completion behavior is now shared across note cards and editors.** Parent/child checklist completion rules, including ghost parent rows in completed sections, now use a shared hierarchy helper, so note cards, the checklist editor, and the full note editor stay in sync instead of quietly diverging.
- **Admin user usage totals now span all owned workspaces**, not just the first one they happened to create. User Management reports database, document/file, and image usage across every live workspace a user owns.

### Fixed
- **Checklist editors didn't match note-card parent/child completion behavior.** Toggling a parent now cascades to its children, and unchecking a child correctly reopens a completed parent, in both checklist editing surfaces.
- **Mobile checklist alignment broke when the note card's view changed.** Checklist rows now remeasure line wrapping when the card or viewport layout changes, preventing checkbox/text drift after switching views.
- **Card masonry layout kept remeasuring while hidden or in list-style views**, wasted work nobody needed. Hidden card grids now freeze their resolved columns, and list/strip layouts no longer overwrite the masonry height cache that card view depends on.
- **User Management modal layout and scroll behavior needed tightening.** The modal now locks background scrolling, shows clearer usage categories, and uses a more compact control layout on desktop and mobile.
- **List and detailed-list label metadata duplicated label text.** List-style note rows now keep only the single label summary badge instead of repeating label names inline right next to it.

## 1.1.39 - 2026-04-05

### Added
- **BubbleView cross-workspace notes overview.** A new bubble-layout mode for the note grid shows every note as a sized, floating circle. Importance is encoded by bubble size using an eight-class scale derived from pin status, reminder presence, recent edits, and collaborator count. Bubbles are arranged in a seeded organic scatter layout — each one uses a deterministic y-stagger, rotation, and float-animation timing derived from its id hash, so the layout stays stable across devices and re-renders instead of reshuffling randomly. A zoom slider (also Ctrl+scroll / pinch) resizes all bubbles uniformly. Workspaces sharing the same note get a subtle color border. Ghost-click prevention keeps iOS taps on animated bubbles from accidentally opening a note.

### Changed
- **Bubble activity scores converge smoothly for remote clients now.** Rather than jumping to a new size class the instant a collaborator edits a shared note, scores advance by a 1.5s exponential-moving-average tick (α = 0.10), so size changes converge gradually over ~37 seconds instead of snapping like a startled cat.
- **Display-Size sliders now use an explicit Save commit.** The Bubble Zoom and Font Scale sliders in Preferences → Appearance show a live preview while dragging but only write to the database on Save. Closing or navigating back without saving reverts the sliders to their last committed values, so an accidental drag can't silently stick.

### Fixed
- **Bubble scores inflated just from opening a note.** `lastAccessedAt`-only writes and empty Y.js transactions no longer advance `updatedAt`, so a note stops looking freshly edited simply because someone looked at it.
- **iOS editor caret hid under the keyboard.** After the iOS virtual keyboard animates in, a 320ms delayed re-check of `ensureEditorSelectionVisible` scrolls the caret into view once the keyboard has actually finished settling.
- **Sidebar swipe gesture rubber-banded on iOS.** The open handler now sets a `didOpen` flag and always calls `preventDefault` while a touch is being tracked; the close handler sets `horizontalLocked` once vertical drift exceeds the threshold, preventing an accidental dismiss when you're just trying to scroll vertically.
- **Bubble zoom slider drag was unresponsive on iOS PWA.** WebKit's internal range-input drag handler gets disabled by `touch-action:none`. Replaced with explicit `setPointerCapture` plus manual `clientX`-to-value computation, so the slider actually responds to touch-drag in standalone mode.
- **Editor toolbar was double-counting the bottom safe area on iOS.** A duplicate `padding-bottom: env(safe-area-inset-bottom)` on `fullscreenOverlay` pushed the toolbar too far down; the redundant declaration is gone.
- **Checklist checkbox misaligned at non-default font scales.** Note-card checkboxes now use a scale-aware `calc(var(--note-card-font-scale, 1) * 0.675rem - 9px)` top margin, so the checkbox center tracks the first text line correctly at any font size instead of just the default one.

## 1.1.33 - 2026-04-04

### Added
- **Persistent QR code share links.** The QR Code Invite section of the Share Note and Share Workspace modals now displays all previously-generated, non-expired share links immediately when the modal opens — no regeneration required. Each active link shows its role badge and expiry, with Copy and View QR buttons. A count badge on the section header shows how many active links exist. Links are stored in `localStorage` keyed by entity, role, and expiry, so a 7-day Viewer link and a 30-day Editor link get tracked independently and both stay accessible until they actually expire.
- **Multi-link QR code list.** Generating multiple links for the same note or workspace (different roles or expiry windows) now produces a visible list entry for each unique combination instead of quietly replacing the previous one.

### Fixed
- **iOS PWA never received app updates**, which is about as bad as PWA bugs get. iOS Safari standalone mode doesn't reliably trigger the service worker `controllerchange` event or `window.location.reload()` in a frozen WKWebView. Added a `GET /api/version` endpoint and a polling loop in the PWA module that compares the server version to the build-time `__APP_VERSION__`. On a mismatch, the app navigates via `window.location.replace('/')`, which reliably escapes the frozen snapshot and loads fresh assets — `reload()` alone couldn't be trusted to do that on iOS.
- **iOS bottom navigation bar was transparent, letting the note grid bleed through underneath.** The system home-indicator/gesture bar area rendered transparent on iOS PWA. Added a `::after` pseudo-element on `.test-harness-root` (mirroring the existing `::before` for the status bar) that fills the bottom safe-area inset with `--color-app-bg`.
- **Android navigation bar theme color was wrong.** The `meta[name="theme-color"]` value was using `surfaceColor` instead of `appBackground`, causing Android's system navigation bar to mismatch the app background. Corrected to `appBackground` in `applyTheme()`, and aligned the initial HTML value with the actual dark theme color.
- **Disclosure arrow misaligned in accordion headers that lack a count badge.** The chevron on the "Send Invite", "QR Code Invite", and "Create User" section headers appeared right beside the label text instead of at the right edge, because `.sectionSummaryLabel` uses `max-width: fit-content` and without a `summaryCount` element carrying `margin-left: auto`, there was nothing to push the arrow right. Fixed with a `:has()` CSS selector that applies `margin-left: auto` to the arrow whenever no `summaryCount` sibling is present. Applied to all three accordion modal stylesheets.
- **Service worker `controllerchange` now uses `replace()` instead of `reload()`**, for consistency with the network-version update path and better reliability on iOS specifically.

### Added
- **Password reset by email link.** Users can now request a reset link from the login form, receive a one-hour password reset email, and securely choose a new password from the app.
- **Per-platform external notification delivery.** Server notification delivery can now be configured independently for Web, Android, and iOS with push, email, auto-fallback, or off modes, including branded reminder and test emails when SMTP is available.
- **Full-featured quick-create note editing.** New text notes and checklists now open as real notes immediately, so reminders, labels, collections, collaborators, links, media, images, and editor undo/redo are all available during creation instead of only unlocking after the first save.
- **Per-note auto-scroll toggle and note-card interaction preference.** Editors now expose an auto-scroll toggle, and Preferences lets each device choose whether note cards open on tap or allow direct interaction with checklist items and links.

### Changed
- **Collection-aware note creation.** Creating a note while filtered to a collection now seeds the new note into that collection and shows an inline checkbox in the editor, so it can be returned to Personal immediately if that wasn't the intent.
- **Notification and upload UI polish.** Preferences now shows the effective delivery mode for the current platform, and file/image/avatar pickers use explicit choose-file controls with clearer empty-state messaging.
- **Note presentation and bubble-view polish.** Note cards now clamp long checklist lines, show a softer overflow indicator, and optionally expose live checklist/link interaction, while bubble view handles shared placements better and uses the borderless bubble treatment.

### Fixed
- **Empty draft cleanup wasn't metadata-aware.** Auto-discard for newly-created notes now preserves drafts that contain reminders, labels, collections, links, media, documents, or collaborator changes, even when the text body is still blank — a blank body isn't the same as an empty note.
- **Quick-create collection flow broke App's hook order.** The selected-note metadata hook now stays in the stable top-level hook section, eliminating the runtime hook-order error the new collection-aware create flow had introduced.

## 1.1.31 - 2026-03-30

### Added
- **Workspace Images gallery.** Added a dedicated Images sidebar view showing every visible note image in the current workspace with square thumbnails, shared filtering/sorting/grouping support, offline preview fallback, OCR-aware search, and full-image viewing.
- **Shared note-grouping utility.** Extracted reusable week/month grouping helpers, so the main note grid and the new Images gallery stay aligned on section labeling and bucket boundaries instead of drifting apart over time.

### Changed
- **Images gallery cards are denser on mobile.** Thumbnail metadata now stays compact with just the note title, optional collection name, label and collaborator counts, and date — less vertical real estate wasted on a phone screen.
- **Images sidebar polish.** Removed the unused Archive sidebar entry and refined the gallery header into a compact sticky status bar, while keeping active sidebar filters visible in the Images scope.

### Fixed
- **Bubble titles didn't refresh immediately after note edits.** Active-workspace bubbles now read the live note title/content from the note doc and resubscribe to title/content/checklist changes, instead of relying on stale registry-only values.
- **Switching workspaces from Images got stuck or hung on loading.** Workspace clicks now return to the notes view, and the underlying note grid stays mounted so workspace activation can still complete and dismiss the splash screen properly.

## 1.1.30 - 2026-03-30

### Added
- **Device-local note-card completed-state persistence.** Checklist note cards now restore the completed-items dropdown state immediately on the same device, including after reloads and offline restarts.

### Changed
- **iOS Safari and standalone mobile polish.** Updated viewport handling, safe-area layout, modal spacing, and note-card/checklist touch targets to behave more consistently on iPhone Safari and iOS installs.
- **List and strip drag interactions now animate like checklist moves.** Flat note rows use neighbor-shift reorder animation, suppress accidental post-drop opens on touch, and clear selection more cleanly after a mobile drag commits.
- **Completed-items controls on note cards are easier to use.** Expanded spacing, a clearer disclosure arrow, and larger invisible checkbox hit targets reduce accidental taps on mobile without changing how big the visible controls actually look.

### Fixed
- **Bubble scoring grew notes just from opening them**, which made "important" mean "recently glanced at." Internal access/seeding writes are now excluded from note activity timestamps, so bubble size reflects meaningful updates instead of editor/view lifecycle noise.
- **Bubble size wasn't consistent across devices.** Bubble importance no longer mixes in device-local activity storage, so the same note renders with the same weight everywhere instead of looking different depending on which device you're on.
- **iOS Safari refresh jumped to a different workspace out of nowhere.** Startup now always seeds the local workspace-selection cache during auth/bootstrap flows, preventing a refresh from landing on a transient server workspace left behind by background preload.

## 1.1.29 - 2026-03-29

### Added
- **Four note-grid view modes, with persistence.** Added `Card`, `List`, `Strip`, and `Bubble` view modes with a dedicated top-of-grid toggle. The selected mode is stored locally per device and restored on next load.
- **List and strip layouts for notes.** `List` mode renders compact one-row notes (title + status badges), while `Strip` mode renders taller rows with a one-line content preview for faster scanning.
- **Cross-workspace bubble overview.** A new `Bubble` mode visualizes notes from every accessible workspace in a three-lane layout with size-weighted emphasis, workspace color distinction, and zoom controls (Ctrl+scroll or pinch).

### Changed
- **Grid rendering now supports mode-specific layouts.** The Note Grid conditionally renders masonry cards or flat rows depending on the active mode while preserving existing selection and more-menu behavior.
- **Localized view-mode labels.** Added English and Spanish locale strings for every view mode control and accessibility label.

## 1.1.28 - 2026-03-29

### Added
- **Per-user note color preferences.** Note background colors now live in each user's local device storage instead of the shared Yjs note document. Color choices are completely private now — changing a note's color on one account no longer broadcasts the change to collaborators, which honestly should have been the default from day one. Legacy color tokens already written to the Yjs doc stay visible as a migration fallback until you pick a new color.

### Fixed
- **Shared notes couldn't be drag-reordered.** Accepted shared notes silently snapped back to their original position after every single drag. The note-order guard was treating shared note aliases as orphans (since they don't appear in the user's own notes registry) and deleting them from the order array on every render — a slow-motion self-inflicted wound. Shared aliases are now whitelisted, so committed drag positions actually stick.

## 1.1.27 - 2026-03-29

### Added
- **Past-due reminder filter, in two places.** Added `Past due` under both `Sorting > Filters` and `Reminders`, so overdue reminder notes can be isolated quickly instead of scrolled past.
- **Sort-direction toggles for primary sort modes.** `Date created`, `Date updated`, and `Alphabetical` now support explicit ascending/descending direction with visible direction markers.

### Changed
- **Sort chips support in-place direction toggling.** The `Sort:` filter chip at the top of the notes grid is now interactive for toggleable sort modes, so direction can flip directly from the grid without reopening sidebar menus.
- **Mobile sidebar spacing and expansion behavior tuned.** Sub-item touch spacing was adjusted for coarse pointers while preserving tight vertical stacking; expanded sorting groups now remain visible without clipping inside an internal submenu scroller.
- **Workspace sidebar row simplified.** Removed the inline `- <active workspace>` text next to the `Workspace` top-level entry.
- **Redis deployment guidance clarified and enabled by default in compose.** Documentation and compose defaults now describe Redis as recommended for push badge reliability and required for multi-instance setups.

### Fixed
- **Mobile/PWA reminder notifications couldn't reliably be cleared.** Clear action enablement now respects pending reminder count in addition to currently-loaded reminder rows, preventing a disabled clear state when the count was very much not zero.
- **Sorting submenu overlap/legibility issues.** Adjusted submenu row metrics and nested spacing to avoid overlap and preserve readability when multiple sorting sections are expanded at once.

## 1.1.26 - 2026-03-29

### Fixed
- **Notification bell badge stopped showing after re-scheduling a reminder.** When a note reminder fired, the user opened the notifications panel (acknowledging it), and then re-scheduled a new reminder for the same note — the badge never showed again. The `PUT /api/push/reminder` upsert wasn't resetting `notificationAcknowledgedAt` on the update path, so the re-scheduled reminder's next firing still looked acknowledged in the DB. The upsert now explicitly clears `notificationAcknowledgedAt: null` on update, so each new reminder cycle starts fresh instead of inheriting old state.
- **Notification bell badge didn't update in real time without Redis.** In single-instance deployments without Redis, the reminder scheduler had no way to push a `reminder-fired` WS event to open browser tabs directly — it only published to Redis, a no-op when Redis is absent. The scheduler now accepts an `onReminderFired` callback that does both the in-process WS broadcast and the Redis cross-instance publish, following the same pattern as every other workspace-metadata event. The badge now refreshes the moment a reminder fires, Redis or no Redis.

## 1.1.25 - 2026-03-29

### Fixed
- **Infinite WS reconnect storm with multiple tabs, eliminated.** With two browser tabs open on different workspaces, switching workspace in one tab updates the JWT cookie to the newly-active workspace. The other tab's Yjs providers then reconnect carrying the new JWT but the *old* workspace's room prefix (e.g. `oldWorkspaceId:__notes_registry__`). The server's namespace check saw the prefix mismatch, found no `noteCollaborator` row for registry rooms, and closed the connection — which the client immediately retried, flooding the server with queries and making the connection indicator flicker forever. Fix: when the room prefix doesn't match the JWT's active workspace, the server now first checks whether the user is a **member of the room's workspace** (the actual correct security boundary). If they are, the connection is allowed with their role in that workspace. Only if they're not a workspace member does it fall back to checking for a shared-note collaborator entry.

## 1.1.24 - 2026-03-30

### Fixed
- **Bell badge only updated on devices that actually received a push notification when a reminder fired.** The scheduler now publishes a `reminder-fired` workspace-metadata WS event (scoped to the owner) immediately after the push is sent. Any open browser tab for that user picks it up and calls `refreshNoteShareState` directly, updating the badge without waiting for a manual refresh or reconnect.
- **Notification panel didn't list fired reminders at all.** The bell panel previously showed only share invitations and app updates — fired reminders never showed up as actionable entries, which is a strange omission for a reminders feature. A new `GET /api/push/reminders/fired` endpoint returns unacknowledged fired reminders (note title, due time). The notifications panel now renders a reminder section at the top; clicking **Open note** closes the panel and navigates to the note, switching workspaces first if needed.
- **Multiple reminder notifications collapsed into one, silently.** All reminder push notifications shared the same `tag: 'freemannotes-reminder'`, so a second reminder would just replace the first in the notification tray without telling anyone. Each reminder now uses a per-note tag (`freemannotes-reminder-{noteId}`), so they show up as distinct notifications like they should.

## 1.1.23 - 2026-03-29

### Fixed
- **Note reminders didn't reliably fire push notifications.** The server-side scheduler only searched for reminders whose `reminderAt` was within the upcoming 60-second window (`gte: now`) — any reminder whose window had already elapsed (created after the scheduler already scanned that slot, or a server restart happened at the wrong moment) got permanently skipped, forever. The query now uses only an upper bound (`lte: windowEnd`), so past-due unfired reminders get caught and fired immediately (0ms delay) on the next cycle instead of just being abandoned.
- **Notification bell didn't badge for fired reminders at all.** The in-app bell previously had zero concept of reminders — only share invitations and app updates counted. A new `notificationAcknowledgedAt` column on `NoteReminder` tracks whether you've seen the in-app entry. Two new endpoints (`GET /api/push/reminders/pending`, `POST /api/push/reminders/acknowledge`) expose the unacknowledged count; `refreshNoteShareState` fetches it in parallel with share data, and `totalNotificationCount` includes it. Opening the notifications panel acknowledges all fired reminders and clears the badge.

## 1.1.22 - 2026-03-28

### Added
- **Push notification system (VAPID / FCM).** New `server/pushService.js` delivers Web Push to browsers and PWA installs via VAPID, and Firebase Cloud Messaging to iOS Capacitor builds. A dedicated `server/pushRouter.js` exposes `/api/push/*` REST endpoints for subscription management, status and delivery-log retrieval, test notifications, and reminder registration. Three new Prisma models — `PushSubscription`, `PushNotificationLog`, and `NoteReminder` — back the feature (migration `phase17_push_subscriptions`). Environment variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY` control which channels are actually active.
- **Notifications settings panel in Preferences.** A new `NotificationsSection` component under a Notifications tab shows subscription status, recent delivery logs, and controls for subscribing, unsubscribing, re-registering, and sending a test push.
- **Server-side note reminder scheduling.** When a note reminder is set, the client syncs the timestamp to the server via `PUT /api/push/reminder`. A 60-second poll scheduler fires a push at the reminder time even when the client is offline.
- **Push on workspace invite.** When a workspace invite is sent to an existing registered user, a push notification fires immediately alongside the in-app invite event.
- **Push on note share.** Sharing a note with a registered user now fires an immediate push notification to the recipient too.

### Changed
- **User Management modal uses accordion layout now.** The Users list and Create User form are independently collapsible disclosure panels, matching the pattern already used by Share Note and Share Workspace.
- **Admin user usage stats now report real image and file-storage totals** instead of a hardcoded lie. `/api/admin/users` previously hardcoded `images: 0` and `filesBytes: 0`; it now runs parallel `NoteImage` and `NoteDocument` Prisma aggregates per user and returns accurate counts and byte totals.
- **Manage Collections modal: clicking the active parent collection now deselects it.** Previously there was no way to clear a parent selection from the tree picker without a separate button; clicking the highlighted item now toggles it off.
- **Collection tree sub-item path text removed.** The secondary path label (e.g. "travel / mexico") that appeared below each collection name in management modals is gone.
- **Accordion section titles carry an accent-color pill now.** The section summary label in all three accordion modals (Share Note, Share Workspace, User Management) renders with `--color-accent` foreground, tinted background, and a matching border for clearer visual hierarchy.
- **Trash note cards get the full visual treatment and one-tap restore.** Trashed cards render desaturated, dimmed, and with content blur. Metadata chips are pointer-events disabled. A centered circular restore button overlays the card. Long-press still opens the more-menu on trash cards, same as normal cards.

### Fixed
- **Admin panel always showed 0 images and 0 file bytes for every single user**, no matter how much they'd actually uploaded. Root cause: `adminRouter.js` set `filesBytes = 0` unconditionally — not a bug so much as never having been implemented. Fixed by adding parallel `noteImage.aggregate` and `noteDocument.aggregate` queries and computing real totals from the results.

## 1.1.21 - 2026-03-28

### Added
- **Collections, labels, and reminders for notes.** Added workspace-scoped metadata registries, note assignment flows, reminder scheduling, metadata chips, and explorer-style management modals for organizing notes beyond simple folders.

### Changed
- **Metadata-aware sidebar, filtering, and search.** Collections now render as a nested explorer in the sidebar and modals, active metadata filters show as removable chips, and global search now merges collection and label matches from both offline and server-backed results.
- **Sorting and grouping controls restored.** The Sorting menu again supports manual/date/alphabetical modes plus nested filter and grouping controls, and the note grid can render grouped sections like This week and Last week.
- **Metadata modal and sidebar polish.** Metadata dialogs now share a compact tree picker system with internal scrolling, and nested sidebar submenu spacing was tightened for desktop and mobile.
- **About hero ambient portrait overlay.** Added a faint right-side `FreemanFace` graphic in Preferences > About to reinforce branding without overpowering the primary icon and copy.
- **About HUD layout and metric grouping refinement.** Rebalanced About telemetry so top-row labels render more cleanly and bottom-row metrics split into left/right groups (`Health`, `Memory` on the left; `Uptime`, `Users` on the right).
- **HL2-inspired telemetry palette tuning.** Restored a stronger classic amber/yellow HUD look while retaining theme-aware blending, so labels stay legible across custom light/dark palettes.

### Fixed
- **WebSocket forbidden-namespace reconnect spam.** Session/bootstrap refresh now disables Yjs websocket sync before switching the client manager to a different workspace, preventing registry reconnect storms and repeated Prisma authorization queries.
- **Attachment chip and metadata overlay stability.** Attachment counts now perform a guarded initial remote refresh when local state is empty, and note-card metadata/attachment overlays close more reliably across modal, blur, and visibility transitions.
- **Manage Collections disclosure icon distortion.** Shared metadata modal tree icons keep the correct aspect ratio now, and the Manage Collections, Add Labels, and Add to Collection dialogs scroll cleanly when content grows tall instead of overflowing the modal.
- **Live health state now follows connection status.** About health values react to app connectivity transitions (`100` connected, `50` connecting, `25` offline) and refresh with telemetry polling.
- **About icon recovery after offline transitions.** The About application icon now retries cleanly when reconnecting, instead of staying broken forever once it hit an offline error once.
- **Missing desktop telemetry labels.** `Images`, `Docs`, and `Workspaces` now render as first-class HUD cells across desktop and mobile instead of collapsing into an inconsistent wrapped footer line.
- **Mobile icon edge clipping in About.** Switched the About app icon rendering to fit without side crop on narrow screens.

## 1.1.20 - 2026-03-28

### Added
- **Workspace note move modal with offline-safe replay.** Added a dedicated Move Note flow plus a local pending-move queue that records note transfers while offline and replays them once connectivity returns.
- **About telemetry HUD.** Preferences > About now includes a live status strip backed by a new authenticated `/api/system/hud-stats` endpoint exposing uptime, storage, and usage totals for signed-in users.

### Changed
- **Trash retention preference now supports "Never" with constrained presets.** User preferences now accept `7`, `14`, `30`, or `Never` (`null` in API payloads / `0` persisted server-side), and client parsing treats unset retention as `null` instead of forcing a numeric default nobody asked for.
- **About section visual redesign.** The About panel now uses the updated branding layout, compact HUD typography, and a dedicated bottom-left numeric health indicator (`100/50/25`) to preserve one-row metric density on mobile.
- **Trash view interaction model.** Trash scope now uses restore-first actions, read-only-safe note-card behavior, and updated menu/action wiring to match what you'd actually expect from an archive/trash context.

### Fixed
- **Auto-delete cleanup ran even when retention was disabled.** Scheduled trash cleanup now exits early when retention is disabled and logs the skipped cycle instead of quietly deleting things nobody wanted deleted.
- **Expired-share token cleanup on permanent trash deletion.** Cleanup now removes related note share tokens before deleting expired documents, preventing dangling share records.
- **Mobile note interactions and menu consistency.** Addressed touch/menu edge cases in note cards and more-menu behavior that could conflict with trash-mode actions.

## 1.1.19 - 2026-03-27

### Added
- **Per-device display-size controls for notes.** Added appearance settings for note-card text size, note-editor text size, and maximum note-card height, backed by local cached preferences, server preference sync, and Prisma migrations.
- **Semantic note color themes.** Notes can now store a theme-aware color token that recolors cards, editors, collaborator overlays, and attachment chips without persisting a raw color value that'd look wrong in the other theme.

### Changed
- **Editor title fields now auto-grow and wrap.** Text and checklist editor titles use autosizing textareas with reserved trailing space for upcoming action icons.
- **Checklist editing flow is more caret-aware now.** Pressing Enter inside a checklist row splits content at the caret into a new row while preserving rich-text content and hierarchy, instead of just appending a blank row wherever.

### Fixed
- **Simultaneous note-card taps opened multiple editors at once.** The card open gesture now claims a single touch interaction and suppresses competing touches until the gesture resolves.
- **Mobile shell navigation was inconsistent.** The sidebar edge swipe now works from a fresh app state, mobile search participates in overlay history, Android Back closes search, and iOS/PWA has an explicit close path instead of getting stuck.
- **Reserved workspace names weren't blocked.** Workspace creation and rename now reject duplicate names case-insensitively, including the built-in `Personal` and `Shared With Me` labels and their legacy stored forms.
- **Notification and checklist polish.** Unified bell copy now says `Notifications`, multiline checklist rows have more breathing room, and wrapped title/checklist interactions behave correctly on mobile.

## 1.1.18 - 2026-03-27

### Fixed
- **PWA icon didn't render correctly on Android launchers or iOS.** The source icon is white/light on a transparent background; adaptive-icon launchers (and iOS) fill transparent areas with their own color — often white, which made the logo effectively invisible. Added `purpose: "maskable"` icon variants (`pwa-192x192-maskable.png`, `pwa-512x512-maskable.png`) with an opaque `#0b0f16` background and the logo scaled to fit the inner 80% safe zone. The web manifest now declares four entries: the original transparent icons with `purpose: "any"` (for contexts that preserve transparency) and the new opaque icons with `purpose: "maskable"` (for adaptive launchers). `apple-touch-icon.png` was also replaced with the opaque 180×180 variant — iOS always adds a white layer behind transparent touch icons regardless of what you ask for.
- **App name was corrected to "Freeman Notes."** The installed PWA label, page title, Apple touch icon title, and in-app update notifications previously read `FreemanNotes` (one word), which got clipped to `FreemanN…` on launcher home screens because the OS had no word-break point to work with. Corrected to `Freeman Notes` everywhere (manifest `name`/`short_name`, `<title>`, `apple-mobile-web-app-title`, notification strings). Technical identifiers (package name, storage keys, DB names) are unchanged — this was purely a display-name typo, not a rebrand.

### Added
- **`scripts/generate-maskable-icons.mjs`** — a utility script that regenerates the maskable icon variants and `apple-touch-icon.png` from the source `pwa-512x512.png` using `sharp`. Re-run it whenever the source icon changes.

## 1.1.17 - 2026-03-27

### Fixed
- **Infinite DB call storm whenever the Share Workspace modal was open.** The `onInviteChanged` event handler in `SendInviteModal` was calling `loadInviteState(false)` (a server fetch) in response to `WORKSPACE_INVITE_STATE_EVENT`, which fires after every local IndexedDB write. The server fetch wrote to IDB, re-emitted the event, and created an unbounded loop that slowly exhausted the PostgreSQL connection pool — a self-feeding fire. Fix: the handler now calls `loadInviteState(true)` (cache-read only), since the event actually signals "local cache updated," not "server has new data."
- **Personal workspace wasn't pinning to the top of the sidebar and switcher.** The `systemKind === 'PERSONAL'` check never matched, because personal workspaces have `systemKind: null` in the database — they were being identified by the name pattern `Personal (<userId>)` instead. Added `isPersonalWorkspace()` to `workspaceDisplay.ts` and used it in both the sidebar sort and the workspace switcher modal.
- **Misleading "check cookie/reverse-proxy" error showed up after the server was just overloaded.** The auth error shown when `/api/auth/me` fails right after a successful login POST now reads "server may be temporarily unavailable — please try again" before jumping straight to proxy/cookie configuration suspicion.

### Changed
- **Manage Workspaces button moved to the sticky top of the workspace dropdown.** Previously stuck at the bottom of the scroll container, it's now pinned above the list, so it's reachable no matter how long the workspace list gets.
- **Manage Collections button mirrored to the sticky top of the Collections dropdown.** Same treatment applied to the Collections sidebar submenu.
- **Sidebar submenus are now bounded scrollable regions.** Both workspace and collections submenus have `max-height` and `overflow-y: auto`, so long lists scroll within the sidebar instead of overflowing it entirely.
- **Mobile sidebar scrollbars hidden.** On touch devices, `scrollbar-width: none` and `::-webkit-scrollbar { width: 0 }` suppress overlapping scrollbar chrome inside the sidebar.
- **Share icon redesigned for mobile.** The workspace share button is now a transparent icon-only button with accent highlight on hover/focus. Desktop shows it only on row hover; mobile keeps it always visible at reduced visual weight.

## 1.1.16 - 2026-03-27

### Added
- **Background workspace preload for full offline coverage.** When the app comes online (or 5 seconds after login), a background loop iterates every workspace the user belongs to, activates each one server-side, and pulls its complete registry + all notes into IndexedDB via temporary Yjs providers. This means every workspace is available offline, even one you've genuinely never opened on this device before.
- **Dedicated workspace-selection cache (`workspaceSelectionCache.ts`).** A new localStorage key (`freemannotes.workspace.selection.cache.v1`) tracks the last chosen workspace independently of the auth-session cache. Written on every workspace switch (including offline switches) and read at startup before the server session restores, so the locally-selected workspace never gets clobbered by a stale server response.

### Fixed
- **Offline edits from multiple workspaces didn't all sync on reconnect.** Previously only the server's last active workspace got flushed on reconnect; offline edits made in any *other* workspace were silently lost until you manually switched back to them. The reconnect path now calls `indexedDB.databases()` to discover every workspace with local data, activates each in sequence, and flushes pending Yjs updates before finally activating the target workspace.
- **WebSocket "forbidden namespace" storm, eliminated.** WebSocket sync now stays disabled until the server session successfully activates to the target workspace. Opening WS rooms before activation completed caused the server to reject every message with `1008 forbidden namespace`, triggering an unrecoverable reconnect loop that just spun forever.
- **Workspace label flipped visibly on reconnect.** `refreshActiveWorkspace` now skips updating the displayed workspace name if the server returns a different workspace ID than the locally-selected one, preventing a transient flash of the old workspace name during the activation handshake.
- **Offline workspace switch reverted itself on page refresh.** The service worker can serve a cached `/api/auth/me` response while the backend is unreachable; the app previously misread this as a successful online probe and reverted to the server's (stale) workspace. Network errors during workspace activation are now distinguished from actual server rejections — a network error triggers offline mode while preserving the locally-selected workspace instead of overwriting it.
- **IndexedDB snapshot was overriding an already-determined workspace.** The `loadSidebarWorkspaces` hydration path now only falls back to the IndexedDB active-workspace snapshot when no workspace is set at all, preventing a race where a stale IDB timestamp reverted an already-resolved offline switch.
- **`DocumentManager.discoverLocalWorkspaceIds()`** — new public method that enumerates every `${workspaceId}:${docId}` IndexedDB database and returns the unique workspace ID prefixes, with a graceful fallback when `indexedDB.databases()` isn't available.
- **`DocumentManager.flushPreviousWorkspaceEdits()`** — verifiably flushes offline Yjs edits for a no-longer-active workspace: opens isolated temporary IDB + WS providers, waits for the Yjs state-vector exchange, then tears them down, without touching the active workspace's providers.
- **`DocumentManager.preloadWorkspaceFromServer()`** — new public method that syncs a workspace's full dataset (registry then all notes) from the server into IndexedDB using temporary providers, enabling offline access to workspaces that have never been opened on this device.

### Changed
- **Workspace switcher pinning order.** The switcher now always shows Personal first, then Shared-With-Me, then user-created workspaces, with the active workspace within the user-created group floating to the top.
- **`systemKind` values normalized to uppercase.** `mapWorkspaceList` and `mapWorkspaces` now call `.toUpperCase()` on `systemKind`, so PERSONAL/SHARED_WITH_ME comparisons stay case-insensitive against whatever casing the server happens to send.
- **`onOnline` handler now always probes the session.** The `probeSession` call is no longer gated on `authOfflineMode` — any workspace switch made while online-but-later-going-offline also needs server re-activation on reconnect, and the old gate was preventing that.
- **Background preload is aborted on manual workspace switch.** `handleWorkspaceActivated` increments `backgroundPreloadAbortRef`, so a user-initiated switch immediately cancels any in-progress preload cycle instead of letting it clobber the new selection later.
- **Sidebar workspace name display styles.** Added `sidebar-workspace-inline-summary`, `sidebar-workspace-inline-label`, `sidebar-workspace-current-inline-text`, and `sidebar-workspace-manage` CSS classes to support the updated inline workspace name layout.

## 1.1.15 - 2026-03-26

### Fixed
- **Offline open/close spammed sync work for no reason.** Opening and closing notes while offline no longer triggers redundant sync churn, and reconnect refresh behavior is now scoped to the changed attachment domain instead of everything at once.
- **Attachment chips and overlays weren't stable on mobile.** Expanded chips now close safely via Android Back, avoid click-through to underlying notes, keep active cards above blur layers, and prevent off-screen dropdown placement.
- **Collaborator/media panel scroll interactions bled into the page.** Expanded chip and media panel interactions now isolate internal scrolling and stop accidental page/grid scroll or unintended dismisses.
- **URL preview rail spacing on note cards left an awkward gap.** Mobile note-card URL previews now sit flush to the card bottom with the gap removed.
- **Drag froze near the top edge.** Drag bounds now clamp correctly against section/scope geometry, so dragging to the top edge no longer stalls or locks up entirely.
- **Realtime attachment update reliability was spotty.** Metadata fanout and attachment refresh pathways now propagate link/document/media count updates more reliably across clients.
- **Image viewer swipe transition showed an artifact.** Swiping to adjacent images no longer flashes the previous frame before the next one renders.
- **Media panel visual noise, reduced.** Removed the default `synced` status line and removed OCR thumbnail chips from image tiles — information nobody needed to see at a glance.
- **Media panel caret bled through the sheet.** Caret visibility is now suppressed while the media sheet/flyout is open.

### Changed
- **Media sheet tab transitions.** Added animated transitions for media tab changes across note, checklist, and text editors.
- **Attachment browser modal shell.** Mobile attachment browser modal now uses safer backdrop press semantics and a dedicated handle affordance.
- **Editor/mobile spacing and sheet polish.** Updated layout spacing and sheet styling to keep scope/header/card geometry consistent on small screens.
- **Localization and rich-text support refinements.** Updated i18n and rich-text handling paths touched by the media/editor interaction fixes above.

## 1.1.14 - 2026-03-26

### Fixed
- **Offline image uploads looked stuck**, even though they weren't. File uploads now queue immediately offline, close the modal without a hanging spinner, and replay reliably on reconnect.
- **Theme preferences didn't apply while offline.** Local theme changes now apply and persist instantly, then sync back to user preferences once connectivity returns.
- **Offline image previews lost their sharp framing.** Cached/queued media thumbnails now preserve aspect ratio and improved progressive quality, so note image tiles stay clear and correctly cropped offline instead of looking squashed.
- **Workspace renaming didn't work offline.** Renames now queue, apply to cached workspace snapshots immediately, and replay to the server on reconnect.
- **URL preview metadata didn't hydrate after an offline reconnect.** Link sync now uses queue-aware reconnect retries, deduplicated background hydration, and placeholder-safe merge rules, so metadata resolves without needing a manual page refresh to shake it loose.

## 1.1.13 - 2026-03-16

### Added
- **Bell-based app update notifications.** Available app updates and post-update confirmations now appear in the main notifications modal, so update status is visible alongside invites and link issues instead of living somewhere separate.

### Changed
- **Safer automatic PWA updates.** Service-worker refreshes now wait until the app is idle or no longer blocked by active editors and modals before applying automatically, instead of yanking the rug out mid-edit.
- **Android launch icon metadata.** The web manifest now advertises the standard 192px and 512px app icons as both regular and maskable-capable launch assets, so Android uses the current primary branding during install and startup.

## 1.1.12 - 2026-03-16

### Changed
- **Subtle header connectivity indicator.** The app icon now carries a thin status line that stays invisible while connected, uses the active theme accent while reconnecting, and switches to a soft animated red scan when offline.

## 1.1.11 - 2026-03-16

### Added
- **Dedicated User avatar settings.** Preferences now exposes a User section with a standalone avatar editor modal that reuses the registration crop flow for profile photo updates.

### Changed
- **Shared avatar crop plumbing.** Avatar image preparation now runs through a shared client helper, so registration and in-app profile edits follow the same crop and export behavior instead of two slightly different implementations.

### Fixed
- **Immediate avatar refresh after save.** Saving a profile photo from Preferences now updates the current session avatar immediately and keeps the cached authenticated profile in sync.
- **Realtime collaborator avatar propagation.** Profile image uploads now publish targeted metadata events, so connected collaborators refresh user avatars without opening another screen or reloading.

## 1.1.10 - 2026-03-16

### Changed
- **PWA install identity.** Android install metadata now uses `FreemanNotes` for both app name and short name, and the web manifest advertises the standard 192px/512px icons instead of the maskable set.

### Fixed
- **Link-preview image hydration was incomplete.** Note-card URL preview rails now background-refresh incomplete cached preview rows, and the server rehydrates stale link preview metadata on fetch, so hero images show up without needing to open the editor first.
- **Docker avatar upload reliability was shaky.** Post-registration avatar uploads now wait for the authenticated session to be confirmed before sending the multipart request, reducing missed writes in container deployments.
- **Docker upload diagnostics were missing.** Container startup now warns when the configured upload directory isn't writable by the runtime user, making bind-mount permission problems visible immediately instead of a silent failure three steps later.

## 1.1.0 - 2026-03-16

### Added
- **Progressive Web App support.** Added `vite-plugin-pwa`, an installable web manifest, generated app icons, a custom service worker, offline-ready/update state, and install flows for both prompt-capable browsers and iOS Safari.
- **Queue-aware offline sync bridge.** Existing note, link, document, media, and collaborator offline queues now request background sync through the shared PWA client/service-worker path instead of waiting only for a foreground reconnect.

### Changed
- **Preferences install surface.** Preferences now only shows app-install actions when installation is actually available, with browser-specific instructions and mobile-safe modal overflow handling.
- **Production avatar freshness.** Profile image uploads now return cache-busted URLs, so a newly-registered avatar shows up immediately in Docker and other long-cache deployments instead of waiting out a stale cache.
- **Collaborative preview hydration.** Note-card link rails now treat live Yjs link metadata changes as a signal to refresh cached remote previews, so collaborators see preview content update without a manual reload.

### Fixed
- **Offline navigation and caching behavior needed work.** The service worker now preserves an app-shell fallback for navigations, keeps API/image caching scoped by intent, and avoids filling image cache storage with oversized local originals.
- **Remote link-preview propagation was inconsistent.** Server-fetched link preview records now emit the same change event as local queue writes, keeping rails, panels, and fresh devices in sync after remote refreshes.
- **WebP avatar delivery was mislabeled.** Production upload serving now correctly advertises `image/webp` for normalized profile photos.

## 1.0.98 - 2026-03-16

### Added
- **Unified selected-text copy conversion.** Full text editors now support copying the active selection as either Markdown or Rich Text using shared conversion utilities, also scaffolded for browser extension, Android, and iOS reuse down the road.
- **Offline note search coverage.** Search now falls back to local note, OCR, document, link-preview, and collaborator caches when the app is offline, instead of just coming up empty.
- **Doc-viewer based document reader.** Document browsing now uses `@iamjariwala/react-doc-viewer` with cached blob resolution, built-in annotation persistence, and safer fallback download handling for unsupported formats.

### Changed
- **Text editor copy UX.** The previous selection bubble copy flow has been replaced with toolbar copy-mode toggles, desktop/mobile shared state, a heading dropdown, and copy-mode toasts that align with normal keyboard/browser copy behavior.
- **Document availability controls.** Document-add entry points now show temporary Coming Soon states while existing document browsing remains available through the new viewer pipeline.
- **Offline/media refresh behavior.** Note-card attachment and link-preview surfaces now avoid unnecessary remote refreshes during drag/reorder work while still allowing one-time hydration on fresh devices.

### Fixed
- **Mobile copy-mode parity.** Floating mobile toolbars now default to Rich Text, stay in sync with the underlying editor state, and render copy-mode status toasts above the visible toolbar instead of underneath it.
- **Clipboard fidelity was inconsistent.** Markdown and rich-text copy conversion now preserve block structure, line breaks, tables, and task-list markers more reliably across paste targets.
- **Fresh-device and offline preview hydration were rough around the edges.** Link preview art, cached document blobs, splash timing, and document-viewer refresh behavior all tolerate cold starts, websocket nudges, and offline reopen flows better now.

## 1.0.97 - 2026-03-14

### Added
- **Document attachments with in-app browsing.** Notes can now carry PDFs and office-style documents with upload queues, OCR-backed text extraction, generated previews, and dedicated image/link/document attachment browsers.
- **Link preview infrastructure.** Notes now persist URL preview metadata, resolve richer site cards server-side, surface failed preview notifications, and expose link management in cards, editors, and note menus.
- **Attachment-aware note chips.** Note cards now use a single attachment chip that expands into images, links, and documents, instead of every attachment type fighting for its own limited chip space.

### Changed
- **Rich-text editing breadth.** Editors now support broader Markdown paste conversion, task lists, tables, blockquotes, code blocks, horizontal rules, extra heading levels, and URL-preview insertion directly from the toolbar.
- **Note-card preview fidelity.** Cards now render richer text structures, compact table summaries, tighter link rails, and consistent attachment/browser styling across desktop and mobile.
- **Grid ordering durability.** Drag-and-drop now preserves intended column placement more reliably across devices by syncing column slots alongside reading order.
- **Release documentation.** Updated code comments across the new attachment, document, link-preview, and modal plumbing, plus refreshed top-level project docs for self-hosted deployment.

### Fixed
- **Drag-and-drop stability regressions.** Fixed post-drop reshuffling, tall-card placement drift, and horizontal swaps that were triggering before the dragged card had even visually crossed columns.
- **Editor and modal scroll behavior needed cleanup.** Hidden editor scrollbars now stay scrollable, the background grid stops scrolling while editors are open, and mobile attachment/document modals properly lock background scroll.
- **Preview hydration and collaboration polish.** Fixed rich preview materialization after reload, collaborator modal access-state timing, viewer-role media visibility, and several mobile editor/caret interaction edge cases.

## 1.0.95 - 2026-03-13

### Added
- **Durable offline image previews.** Viewed note images now fall back through service-worker cached full images, IndexedDB-backed preview blobs, and explicit placeholders, so media stays understandable offline after reloads instead of just going blank.

### Changed
- **Realtime media refresh routing.** Note-media websocket nudges now stay scoped to media state, coalesce burst deletes per note, and update note chips across devices without repainting the rest of the workspace UI.
- **Mobile media viewer polish.** The fullscreen image viewer now relies on Back-only dismissal, keeps its header actions stable on coarse-pointer layouts, and surfaces offline-preview context inline.

### Fixed
- **Image and collaborator chip hydration was inconsistent.** Note cards now resolve shared aliases back to source room IDs, refresh image counts on first paint, and hydrate collaborator chips correctly on fresh devices and same-user multi-session setups.
- **Offline media controls were too restrictive.** Remote thumbnail delete affordances remain enabled offline, so queued image removals can be staged directly from the gallery instead of waiting for connectivity.

## 1.0.94 - 2026-03-12

### Added
- **Image uploads, galleries, and OCR search.** Notes now support file and URL image imports, thumbnail galleries, fullscreen viewing, server-side OCR extraction, and global search matches that include extracted image text.
- **Offline-safe media staging.** Added IndexedDB-backed upload and delete queues, so note media changes appear immediately offline and replay once connectivity returns.
- **Archive-aware media/search plumbing.** Note metadata, search grouping, and image result routing now include archive state alongside Personal, shared, and workspace note locations.

### Changed
- **Mobile media navigation.** Image viewers and note media sheets now use layered history tokens, swipe navigation, and explicit close routing, so Back closes the top-most media surface before unwinding the editor underneath it.
- **Search result context.** Workspace labels, collaborator matches, and image-result placeholders now render clearer prefixes, hide raw UUIDs, and open directly into the relevant note or media browser.
- **Container OCR runtime.** Docker packaging and compose defaults now ship the Python/PaddleOCR runtime and OCR environment wiring required for note-image processing in production.

### Fixed
- **Shared-note placement visibility was off.** Notes accepted into Personal or other workspaces now render in the active workspace view instead of being locked to only Shared With Me.
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
- **Admin password reset workflow.** User management now opens a dedicated reset modal that sets the new password directly instead of generating a temporary password nobody wants to relay by phone.
- **Release documentation.** Added targeted implementation comments across the new workspace-invite, activation, and password-policy paths introduced in this patch release.

### Fixed
- **Workspace activation hydration was slow.** Accepting or activating a workspace now confirms the server session before reconnecting realtime state, so notes appear immediately without a manual refresh.
- **Collaboration and invite polish.** Note collaborator lists now surface workspace-inherited access correctly, stale online member mutations no longer fail on cached roles, and the share-workspace label layout no longer overlaps the identifier input.

## 1.0.91 - 2026-03-11

### Added
- **Workspace sharing and invite management.** Added secure workspace share links, richer invite delivery paths, invitation notifications, workspace member management, and offline-safe invite replay plumbing.
- **Role-aware workspace access controls.** Added shared workspace role helpers across the client and server, so `OWNER`/`ADMIN`/`EDITOR`/`VIEWER` behavior stays consistent for navigation, editing, sharing, and websocket sync.
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
- **Shared With Me selection persistence.** Added per-device storage for the active Shared With Me folder, so shared subtree selection survives reloads, restores, and workspace re-activation.
- **Earth & Neutral theme family.** Added a new curated theme category with sixteen earthy and neutral palettes, plus localized picker labels in English and Spanish.
- **Offline collaborator queue cache.** Added IndexedDB-backed collaborator snapshot and action-queue storage, so collaborator changes can be staged offline and replayed once connectivity returns.

### Changed
- **Workspace and mobile shell UX.** Simplified the mobile header into a fixed single-row layout with a search overlay, made the workspace tree scrollable, surfaced the active workspace path in the sidebar, and added a sticky scope chip above the notes grid.
- **Share notification and collaborator flows.** Shared placement lookups now target the Shared With Me workspace explicitly, notification history can be cleared locally, collaborator rows show richer identity data, and collaborator role edits now sync through the same offline-safe pipeline.
- **Release documentation.** Added targeted functional comments across the new offline collaborator cache/replay and notification dismissal paths.

### Fixed
- **Dev authentication under Vite was unreliable.** Login now waits for `/api/auth/me` to confirm a real session before entering the authenticated state, and local dev cookies no longer get marked `Secure` on plain HTTP where they'd just get silently dropped.
- **Shared With Me disclosure wasn't correct.** Shared folders stay visible even when Personal is active, and accepted placements restore the intended shared folder instead of collapsing back to the workspace root.
- **Mobile sidebar stability was off.** Opening the mobile drawer no longer shifts the notes grid mid-scroll, because the page lock now uses overflow suppression instead of `position: fixed`.

## 1.0.80 - 2026-03-09

### Added
- **Note collaboration and recipient placement flows.** Added collaborator management, share notifications, Shared With Me placement handling, and accepted-shared-note alias mounting, so users can receive notes into Shared With Me or Personal views.
- **Workspace and note share link tooling.** Added link-generation, copy/open, QR rendering, and client-side caching for workspace invites and public note share links, including public share route rendering.
- **Shared With Me system workspace support.** Added server helpers and note-share APIs to provision the system workspace, persist accepted placements, and expose collaborator/invitation state to the client.

### Changed
- **Workspace sidebar behavior.** Shared With Me now uses normalized display labels, nested folder disclosure, and root-vs-subfolder filtering, so shared notes surface in the correct workspace branch instead of the wrong one.
- **Invitation and share UX.** Workspace invites can now be generated without SMTP delivery, collaboration modals follow the active theme, and share notifications present richer note/inviter context with explicit placement choices.
- **Release documentation.** Added branch-level and inline implementation comments across the new sharing, routing, caching, and collaboration flows introduced in this release.

### Fixed
- **Collaboration permissions were backwards for recipients.** Recipients now see self-removal instead of owner-style revoke controls, and self-removal no longer throws a forbidden error while still, somehow, actually removing access successfully.
- **Live collaboration refresh lagged behind reality.** Open collaborator and notification views now refresh when remote users accept, decline, revoke, or relocate shared notes.
- **Shared With Me placement correctness was off.** Shared With Me root no longer duplicates subfolder contents, and switching workspaces on desktop no longer collapses the Shared With Me disclosure list.

## 1.0.71 - 2026-03-09

### Added
- **Workspace deletion recovery plumbing.** Added live-workspace server helpers, cross-instance workspace metadata event handling, and client IndexedDB queue/snapshot support, so deleted workspaces immediately roll users onto a valid fallback workspace instead of leaving them stranded.
- **Per-device quick-delete preference for checklist rows.** Added device-scoped persistence and preferences UI for always-visible checklist delete affordances on touch devices.

### Changed
- **Workspace switching offline model.** Workspace creation/deletion now uses a cache-first modal/sidebar flow with queued offline mutations that replay when connectivity returns.
- **Mobile editor keyboard handling.** Text and checklist editors now keep the software keyboard stable across row activation, drag handoff, quick-delete, and floating-toolbar presentation changes.
- **Rich-text behavior and spacing.** Full note editors now use tighter single-line Enter behavior, empty list items exit their list on a second Enter, and ProseMirror spacing selectors target the correct root node.
- **Release documentation.** Added branch-level and line-level implementation comments across the modified workspace, offline-sync, editor, and Vite proxy paths.

### Fixed
- **Deleted workspace session repair.** Local and remote workspace deletions now clear stale active workspace state, refresh cookies/device preferences, and show a recovery notice instead of leaving the app pointed at a tombstoned workspace like nothing happened.
- **Mobile note editing regressions.** Fixed header scroll gesture loss, keyboard flicker during caret placement, and caret visibility near the keyboard for text notes and checklist rows.
- **Dev proxy resilience was weak.** Vite proxy and embedded Yjs websocket handling now better tolerate backend restarts and socket resets without crashing the dev server outright.

## 1.0.70 - 2026-03-09

### Added
- **Rich-text editor foundation for notes and checklist rows.** Added TipTap/Yjs-backed rich-text helpers, shared editor components, and supporting toolbar/viewport preference hooks.
- **Mobile keyboard viewport helpers.** Added dedicated visual viewport hooks, so editors can clamp to the visible viewport and keep floating controls aligned above the software keyboard.
- **Theme-aware app icon assets.** Added `darkicon1.png` and `lighticon1.png` for updated splash/icon usage.

### Changed
- **Text note creation flow.** New text notes now persist both plain text and structured rich-text content, so draft and saved editors stay aligned instead of drifting apart.
- **Checklist editing UX on mobile.** Checklist rows now use richer inline editing, improved drag ghost rendering, faster drop settling, and keyboard-aware bottom chrome behavior.
- **Editor overlay navigation.** Mobile overlay history now guards against repeated back taps, and create/edit overlays are rendered mutually exclusively, so they can't stack on top of each other.
- **Preferences and translations.** Updated preference UI styling/behavior and refreshed localized strings for the new editor capabilities.

### Fixed
- **Note editor render-time update warning.** Opening a text note no longer mutates Yjs content during render, removing the `Cannot update a component (NoteGrid) while rendering a different component (NoteEditor)` warning that was cluttering the console.
- **Mobile drag/close reliability.** Removed passive touch-path focus suppression that caused `preventDefault` warnings, and hardened repeated editor open/close behavior.
- **Keyboard occlusion and scroll stability.** Mobile editors now better cover the keyboard transition area and avoid post-drag scroll-jump regressions.

## 1.0.67 - 2026-03-08

### Added
- **Firefox Android touch-drag polyfill for note cards.** Long-press drag now works on Firefox Android, including a bounded edge-scroll path and protection against pragmatic-drag-and-drop's own broken-drag detection.
- **Expanded sidebar navigation model.** Added nested Reminders, Labels, Sorting, and Collections sections with animated disclosure transitions, desktop collapsed-sidebar auto-expand behavior, and improved mobile drawer interactions.
- **Desktop note-card footer dock.** Note cards now expose an editor-style bottom action dock on desktop hover, with anchored more-menu placement and active-card accent highlighting while the menu is open.

### Changed
- **Mobile sidebar polish.** Removed the collapsed shadow artifact, locked background interaction while the drawer is open, added swipe-to-close, increased item/icon sizing, and refined ordering/spacing.
- **Desktop sidebar readability.** Increased desktop sidebar type and disclosure icon sizing slightly and aligned nested disclosure arrows with the primary sidebar pattern.

### Fixed
- **Workspace logout WS spam.** Clearing the active workspace no longer reconnects the unscoped registry room and spam-retries websocket connections into the void.
- **PWA auth/load startup robustness.** Registry initialization now respects the cached initial workspace ID earlier in boot, reducing reload-time races and splash failures.

## 1.0.66 - 2026-03-08

### Added
- **Device-scoped preferences persistence (Phase 12).** Theme, language, active workspace, and editor/card expansion state now persist via the `user_device_preference` table.
- **Workspace sidebar dropdown list.** The sidebar workspace section expands into a scrollable list (built for many workspaces) with a "Manage workspaces…" entry.
- **Workspace modal active-row emphasis.** Active workspace is pinned to the top, has an accent-highlighted name, and no longer shows an Activate button — it's already active, that button was redundant.
- **Share note action in the more-menu.** Creates a share link (`POST /api/docs/:docId/share`) and uses native share where available, otherwise falls back to clipboard or opening a new tab.

### Changed
- **Sidebar disclosure icon.** Sidebar expand/collapse arrows now use `/public/icons/Arrow.png` with theme-aware coloring.
- **Dev startup resilience on Windows.** `prisma generate` is now best-effort, so DLL locks don't prevent `npm run dev` from starting at all.

## 1.0.65 - 2026-03-08

### Added
- **Desktop more-menu as a real context menu (fine pointers).** Note/editor 3-dot menus now open a compact anchored popover on desktop instead of a full-screen sheet. Mobile/coarse pointers keep the bottom-sheet presentation, which actually makes sense there.
- **Checklist empty-state "Add item."** When all active checklist rows are completed (active list becomes empty), an "Add item" row appears and inserts a new checklist row. Works both when creating a new checklist and editing an existing one.
- **In-app splash overlay + layout animation gating.** After a refresh, the app keeps an overlay up until `NoteGrid` reports its initial data/layout pass is ready, preventing a "paint then immediately animate" flash that looked broken even though it wasn't.
- **Dev boot ordering helper.** Added a small `/healthz` polling helper, so Vite doesn't start proxying before the backend is actually ready to receive anything.

### Changed
- **Notes grid canonical ordering: reading order (row-major).** The Yjs-stored order now represents left-to-right, top-to-bottom reading order. Each device reconstructs its local columns via round-robin dealing, so different column counts still preserve the same visual sequence instead of scrambling it.
- **Drag insertion-point stability.** Column detection uses the raw pointer X (more responsive for cross-column moves) and row detection uses the ghost card edges (matches visible overlap). The post-insertion cooldown was increased to better avoid oscillation during the spring animation.

### Fixed
- **Translation freshness after deploy.** The service worker now bypasses caching for `/locales/` JSON, so updated translations take effect immediately instead of waiting out a stale cache.

## 1.0.64 - 2026-03-06

### Changed
- **Notes grid drag-and-drop: complete rewrite from swap-based to insertion-based.** Cards now slide apart to show where the dragged card will land (via framer-motion `layout` animations) instead of swapping positions on hover, which honestly always looked a little chaotic.
  - Replaced the swap-based drag model with an insertion + placeholder approach: the dragged card's grid slot stays as an invisible placeholder to hold space, while a ghost overlay follows the pointer. Neighboring cards animate into their new positions before the drop.
  - Switched from custom FLIP animation code to framer-motion's `layout` prop and `LayoutGroup` for automatic layout-change animations with real spring physics instead of hand-rolled math.
  - Added `framer-motion` as a dependency.
- **Drag hit detection: nearest-edge vertical detection.** The ghost card's top edge is used when dragging up, and its bottom edge when dragging down, to determine insertion position. Solves the problem where dragging a tall card above a short card used to require moving impossibly far off-screen. A 16px dead zone around each card's midpoint prevents oscillation.
- **Post-insertion cooldown (150ms).** After each insertion-point change, rect recalculation pauses briefly, so framer-motion's spring animation can settle and intermediate `getBoundingClientRect()` values don't cause oscillation.
- **Post-drop column preservation (sticky columns).** After a drop, the column layout is preserved across re-renders instead of being re-packed by height. Only cards causing egregious height imbalance (>2x tallest-to-shortest ratio) get moved — from the bottom of the tallest column to the shortest — rather than reshuffling all columns every time.
- **Cross-device layout sync.** Column slot lengths (the number of cards per column) are now stored in a Yjs `noteLayout` map alongside the flat note order. Other devices reconstruct the same column grouping via slot-based splitting instead of height-based greedy packing, which used to diverge because card heights differ across viewports. The flat order is now column-major, so slot-boundary slicing actually reproduces the original grouping.
- **Scrollbar stability.** Added `scrollbar-gutter: stable` on `<html>` and `overflow-x: clip` on `<html>`/`<body>` to prevent layout shift during drag-induced column repacks.

### Technical Details
- New files: `layout.ts` (column utilities, insertion-point detection), `useNoteGridDragManager.ts` (drag manager hook), `flip.ts` (height measurement), `autoScroll.ts` (legacy, unused).
- Modified: `NoteGrid.tsx` (framer-motion grid, sticky columns, Yjs layout map), `NoteGrid.module.css` (placeholder + ghost styles), `DocumentManager.ts` (`getNoteLayout()` for Yjs layout map), `globals.css` (scrollbar stability).

## 1.0.63 - 2026-03-05

### Fixed
- Mobile editor open-flow hardening: prevented touch/click compatibility event pass-through when opening note editors (especially checklist rows on Android Firefox/Chrome) by combining pointer capture, post-open interaction guards, and early focus suppression during the guard window.
- Mobile landscape behavior: editor media dock interactions now stay locked closed in landscape, and app header morph transitions are disabled while landscape is active.
- Vite dev websocket reliability/noise: development mode now embeds the Yjs websocket handler by default, preventing `/yjs` proxy socket errors such as `ECONNABORTED`/`ECONNREFUSED` spam during iterative dev runs — the kind of noise that trains you to ignore your own terminal.

### Changed
- Editor title styling (all text/checklist editors, mobile + desktop): removed shaded title background and increased title emphasis (larger + bold).
- Editor dock and formatting labels were aligned across locale dictionaries and i18n fallback messages, keeping UI strings consistent in every language/loading branch.
- Added detailed implementation comments across modified code paths to document branch-specific behavior and interaction guards for whoever reads this next.

## 1.0.62 - 2026-03-05

### Fixed
- Checklist outdent/un-indent now animates row movement (FLIP) to avoid the "teleport" feeling when items change indentation.
- Mobile checklist drag reliability: pointer capture keeps the pending drag gesture from being stolen by scroll/overscroll on first interaction.
- Checklist drag ghost now matches multi-line items more precisely by sizing the clone using the measured text element width (prevents re-wrapping).
- Checklist drag ghost styling is opaque with a solid background for clearer visibility while dragging.

### Changed
- Indenting a top-level checklist item that has children now preserves the max-1-level nesting rule by re-parenting its children to the new parent.
- Textarea auto-sizing is re-triggered on window resize, so wrapped checklist rows don't end up with stale heights after a layout change.

## 1.0.4 - 2026-03-01

### Added
- **Move to Trash (soft-delete).** Notes are now soft-deleted via a `trashed`/`trashedAt` flag stored inside the Yjs document metadata. Trashed notes are hidden from the main grid but remain persisted in PostgreSQL until the server-side cleanup process permanently removes them — no more instant, irreversible deletes.
- `setNoteTrashed()` and `readTrashState()` helpers in `noteModel.ts` for toggling and reading trash state inside a Y.Doc.
- `DocumentManager.trashNote()`, `.restoreNote()`, `.isNoteTrashed()`, and `.permanentlyDeleteNote()` public API for trash lifecycle management.
- **Server-side trash cleanup scheduler** (`server/trashCleanup.js`) — periodically scans all persisted Yjs documents, identifies notes where `trashed === true` and `trashedAt` exceeds the user's `deleteAfterDays` retention preference, and permanently deletes them from PostgreSQL, Redis, and the notes registry CRDT.
- **User preferences backend** — new `UserPreference` Prisma model (`prisma/schema.prisma`) and REST API (`server/preferencesRouter.js`):
  - `GET /api/user/preferences` — returns preferences (upserts defaults).
  - `POST /api/user/preferences` — updates `deleteAfterDays` (1–365 range).
- `GET /api/trash` endpoint in `apiRouter.js` — lists all trashed notes with title, type, `trashedAt`, and size, sorted by most recently trashed.
- **Dev guards #6 and #7** (`devGuards.ts`) — warn in development when trashed notes leak into the visible grid, or when `trashed=true` lacks a valid `trashedAt` timestamp. Cheap insurance against a much worse bug later.
- **Cross-tab trash reactivity.** `NoteGrid` now observes each loaded note's `metadata` Y.Map. When a remote tab trashes/restores a note, the metadata observer bumps a `metadataVersion` counter, `visibleIds` recomputes, and the note appears/disappears without a page refresh.
- **Mobile WebSocket resilience:**
  - `visibilitychange` + `focus` event handlers in `DocumentManager` — force-disconnect and reconnect all WebSocket providers when the tab returns to the foreground, recovering from silent connection death on mobile OS background suspension.
  - `online` event handler triggers the same reconnect cycle on network recovery.
  - `resyncInterval: 30_000` enabled on every `WebsocketProvider` — periodically re-sends Yjs Sync Step 1 to catch silently dropped frames on flaky networks.
  - `maxBackoffTime: 5_000` — caps reconnect exponential backoff at 5 seconds instead of letting it creep toward "give up entirely."
- **Server-side WebSocket ping/pong keep-alive** (`server.js`) — pings every client every 30 seconds; terminates connections that fail to respond, cleaning up dead mobile sockets before the 30-second y-websocket idle timeout gets there first.
- `npm test` script using Node.js built-in test runner (`node --test tests/`).
- 14 tests covering trash toggle, offline sync round-trip, CRDT convergence, cleanup expiry identification, preference validation, and metadata schema.

### Changed
- `App.tsx` — delete action now calls `manager.trashNote()` (soft-delete) instead of `manager.deleteNote()` (hard-delete). A much more forgiving default.
- `trashedAt` stored as ISO-8601 string (e.g. `"2026-03-01T16:07:09.460Z"`) instead of epoch-ms number, for human readability and consistent formatting.
- `NoteGrid` drag and cross-tab-cancel logic now operates on `visibleIds` (filtered by trash state) instead of raw `orderedIds`.
- Server boot sequence extended: Step 3 starts the trash cleanup scheduler; graceful shutdown stops it before flushing persistence.

## 1.0.6 - 2026-03-01

### Changed — Phase 10: Production Persistence Layer

- **Prisma model rename**: `YjsDocument` → `Document` (table: `document`). All server code (`YjsPersistenceAdapter`, `apiRouter`, `trashCleanup`) updated to use the `prisma.document` accessor and simplified `{ docId }` where clauses.
- **`stateVector` now required** (`Bytes`, was `Bytes?`). Every persisted document stores both the full state and its state vector for efficient delta sync on client reconnect.
- **`docId` globally unique** (`@unique`, was compound `@@unique([workspaceId, docId])`). Simplifies lookups — a single `docId` maps to exactly one persisted document. Workspace index (`@@index([workspaceId])`) retained for scoped queries.
- **Formal migration system**: initial migration created (`20260301234035_phase10_init`). Existing databases managed by `prisma db push` get baselined automatically.
  - Production (`NODE_ENV=production`): `prisma migrate deploy` on boot.
  - Development: `prisma db push` on boot (unchanged).
- **New npm scripts**: `db:migrate:deploy`, `db:migrate:status` for production migration workflows.
- **Dockerfile**: runtime comment updated to document auto-migration on boot.
- **docker-compose.yml**: comment updated (Phase 8 → generic).
- **README.md**: added comprehensive setup docs — Docker Compose quick start (managed Postgres), Unraid/external database setup, local development workflow, and database migration commands/workflow.
- **server.js**: header comments updated to Phase 10.
- **dbInit.js**: dual-mode schema sync — automatically selects `prisma migrate deploy` (production) or `prisma db push` (development) based on `NODE_ENV`.

### Migration Notes
- **Existing databases**: if your database was created with `prisma db push` (pre-1.0.6), the old `yjs_document` table needs renaming to `document` before running the new migration. Easiest path: drop and recreate the database (no data loss for Yjs docs — they're ephemeral and resync from connected clients anyway). Or, if you'd rather not:
  ```sql
  ALTER TABLE yjs_document RENAME TO document;
  ```
  Then baseline: `npx prisma migrate resolve --applied 20260301234035_phase10_init`

## 1.0.5 - 2026-03-01

### Changed
- Note cards now use fixed max heights by pointer type (desktop vs coarse/mobile); the max-height slider UI was removed.
- Note card previews no longer clamp text or truncate checklist previews.
- Note cards no longer show internal scrollbars when content exceeds max height; content clips instead.
- Checklist note cards keep the completed-items toggle visible by pinning it as a footer section, even when the checklist body is clipped.
- Editors moved to a fixed-header + scrollable-body layout, so mobile can scroll checklist items while keeping title/actions visible; text editor content now stretches to the bottom of the screen.

### Fixed
- Desktop checklist drag ghost sizing/visuals: width measurement is captured pre-drag, and the ghost shadow stays dark across themes.
- Mobile checklist reordering now handles extreme variable-height items by using 50% crossover semantics against neighbour midpoints (instead of closest-center), with hysteresis to prevent direction-flip jitter.

## 1.0.3 - 2026-03-01

### Added
- **Automatic database provisioning** — the server now creates the PostgreSQL database on first boot if it doesn't exist (connects to the `postgres` admin DB, runs `CREATE DATABASE`). No manual `createdb` or pgAdmin step required.
- **Automatic schema sync on startup** — `prisma db push --skip-generate` runs on every boot to apply new tables/columns without data loss. Destructive changes get rejected and flagged for manual resolution instead of silently nuking a column.
- New `server/dbInit.js` module (database existence check + schema sync) and `server/dbInitCli.js` standalone CLI entry point.
- `npm run db:init` script for manual database provisioning.
- `npm run dev` now auto-provisions the database before starting Vite.
- **Configurable timezone (`PGTIMEZONE`)** — IANA timezone name (e.g. `America/Regina`) read from `.env`. PostgreSQL session timezone is set on boot; all REST API timestamps (Prisma `timestamptz` fields and Yjs epoch-ms metadata) are formatted in the configured timezone. Internal storage stays UTC, as it should.
- New `server/timezone.js` utility module using `Intl.DateTimeFormat` for zero-dependency timezone-aware ISO-8601 formatting.
- `GET /api/timezone` endpoint returns the configured timezone and current server time in both UTC and local tz.
- All REST API responses (`/api/workspace`, `/api/docs`, `/api/docs/:docId`) now include a `timezone` field and format timestamps through the timezone formatter.
- `pg` (node-postgres) added as a production dependency for admin-level DB creation (Prisma can't run `CREATE DATABASE` itself).

### Changed
- Server boot sequence restructured into an async `boot()` function that runs database provisioning → timezone SET → workspace init → listen, guaranteeing the backend is fully ready before it accepts a single request.
- `Dockerfile` CMD simplified to `node server.js` — the server now handles all migration/provisioning internally.
- `docker-compose.yml` updated with `PGTIMEZONE` env var documentation.

### Fixed
- **"Loading…" stuck on remote note creation** — the NoteGrid doc-loading effect used a `cancelled` flag in its cleanup that raced with rapid Yjs observer re-fires. When the effect re-ran before the async doc load resolved, the cancelled closure discarded the result, and `pendingDocLoadsRef` blocked retries — a note that would just sit there loading forever. Removed the `cancelled` flag; dedup is now handled solely by `pendingDocLoadsRef` and the idempotent `setDocsById` functional updater.

## 1.0.2 - 2026-02-28

### Added
- Per-note pending sync status in the connection snapshot model (`pendingSyncNoteIds`), so the UI can render sync state at the card level instead of one blunt global icon.
- New connection status hook (`src/core/useConnectionStatus.ts`) using `useSyncExternalStore` for stable subscription semantics.
- Docker/compose deployment artifacts for simplified self-hosted setup:
  - `Dockerfile`
  - `.dockerignore`
  - `docker-compose.yml`
  - `DEPLOYMENT.md`

### Changed
- Connection indicator UX now shows only connection state globally (green/yellow/red), while pending sync is displayed per note card.
- Note cards now support a local pending-sync badge that appears only for notes edited while offline.
- Touch drag interaction in the note grid was reworked for mobile reliability:
  - Long-press touch activation for drag start.
  - Scroll-vs-drag intent arbitration, so vertical page scroll wins when detected before drag activation.
  - Browser-level touch/pointer suppression only during active touch drag, to prevent simultaneous native scroll + drag fighting each other.
  - Reorder gating and FLIP stabilization around pickup to reduce mobile "bobbing" and startup jitter.

### Fixed
- False pending-sync state after refresh/startup, by filtering non-user/internal registry writes out of pending-sync tracking.
- React production runtime instability (`useSyncExternalStore` snapshot identity), by emitting stable snapshots and change-only notifications.
- Connection-state misclassification, by distinguishing actual browser offline state from a mid-reconnect state.
- Mobile drag jitter and mixed drag/scroll race conditions observed on Android browsers.
- Server/runtime configuration clarity:
  - `YPERSISTENCE` normalization and empty-value handling.
  - Startup logging improvements for `HOST`/`APP_URL`/Yjs websocket URL reporting.

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
- Empty-body note open/delete flow, so untitled/blank notes can still be selected and removed instead of getting stuck.
- Multiple stale/duplicate file conflicts from legacy root-level component files.
- Offline/online sync edge cases, by ensuring provider/doc lifecycle cleanup and consistent room wiring.

## 1.0.1 - 2026-02-27

### Added
- Detailed inline maintenance comments across core app, grid, card, editor, and CRDT files.
- Explicit in-code guidance for where to adjust card width and responsive mobile/desktop behavior.
- Startup reflow-animation suppression comments and drag overlay sizing documentation.

### Changed
- Note grid responsive behavior refined for stability:
  - Desktop card width stays fixed while column count responds to available space.
  - Mobile portrait enforces 2 columns.
  - Mobile card width is computed from stable device short-side values and reused in portrait and landscape.
- Drag overlay width behavior stabilized on mobile to avoid ghost width jumps.
- Initial refresh behavior no longer animates cards back into place during hydration.

### Fixed
- Same-column drag swap visual artifacts from conflicting transform ownership.
- Resize and orientation edge cases causing inconsistent card widths on mobile.
- Mobile landscape scroll jitter that caused subtle card-width changes.

