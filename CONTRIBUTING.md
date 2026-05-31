# Contributing to Freeman Notes

Thanks for your interest in helping with Freeman Notes. This document covers how to set up a local development environment, run the app, and use the built-in debug tools to investigate and report issues.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Local Setup](#local-setup)
- [Running the App](#running-the-app)
- [Environment Configuration](#environment-configuration)
  - [Server config (`.env`)](#server-config-env)
  - [Client build config (`env.vite/`)](#client-build-config-envvite)
- [Debug Tools](#debug-tools)
  - [1. Application Debug Logging](#1-application-debug-logging)
  - [2. Masonry Layout Debug System](#2-masonry-layout-debug-system)
  - [3. Masonry Visual Overlay](#3-masonry-visual-overlay)
  - [4. Workspace Move Tracing](#4-workspace-move-tracing)
- [Reporting a Layout Bug](#reporting-a-layout-bug)
- [Native Platform Companions](#native-platform-companions)
  - [Architecture overview](#architecture-overview)
  - [Building the shared JS bundle](#building-the-shared-js-bundle)
  - [Android](#android)
  - [iOS](#ios)
  - [Browser extension](#browser-extension)
  - [Adding or changing conversion logic](#adding-or-changing-conversion-logic)
- [Running Tests](#running-tests)

---

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** 14+ (running locally or in Docker)
- **npm** 10+
- **Python 3** (optional — only needed for OCR)

---

## Local Setup

```bash
git clone https://github.com/your-org/freemannotes.git
cd freemannotes
npm install
```

Copy the config templates:

```bash
cp .env.example .env
cp env.vite/.env.example env.vite/.env
```

Edit `.env` at minimum:

```
DATABASE_URL=postgresql://freemannotes:freemannotes@localhost:5432/freemannotes?schema=public
AUTH_JWT_SECRET=any-random-string-for-local-dev
```

Initialize the database:

```bash
npm run db:init
```

---

## Running the App

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Node backend, with HMR. **Use this for development.** |
| `npm start` | Full production build then starts the server. |
| `npm run start:server` | Start the backend only (no build). |
| `npm run build` | Build client assets to `dist-build-temp/`. |
| `npm run preview` | Serve the last build locally via Vite preview. |

For development, `npm run dev` is the right command. It starts both the backend (`server.js`) and the Vite dev server concurrently, with hot module replacement for the client.

---

## Environment Configuration

Freeman Notes has two separate env config files that serve different purposes.

### Server config (`.env`)

This file is read by `server.js` at runtime. Copy from `.env.example`.

Key settings relevant to debugging:

```dotenv
# Enable structured server-side debug logging → writes to freeman-debug.log
# Client layout events are also POSTed to /api/debug-log and appended there.
DEBUG_LOGGING=1

# Mirror the client flag (see below) — bakes debug logging into the build.
VITE_DEBUG_LOGGING=1
```

All available options are documented in `.env.example`.

### Client build config (`env.vite/`)

This directory holds Vite build-time env vars (only `VITE_*` keys are exposed to the browser). Copy from `env.vite/.env.example`.

Key settings:

```dotenv
# Bake client-side debug logging into the built bundle.
# When set to 1, you don't need to use the URL flag or localStorage below.
VITE_DEBUG_LOGGING=1
```

> **Note:** These values are baked in at build time. Changing them after a build has no effect — you must rebuild.

---

## Debug Tools

Freeman Notes ships three independent debug systems. Each targets a different layer of the app.

---

### 1. Application Debug Logging

**What it covers:** General client-side events (Yjs sync, document load, workspace changes) POSTed to `/api/debug-log`, plus IndexedDB state tracing.

**How to enable — three methods, in priority order:**

#### Option A — Build-time flag (permanent for all users of that build)

In `env.vite/.env`:
```dotenv
VITE_DEBUG_LOGGING=1
```
Then rebuild. All clients using this build will log automatically.

#### Option B — URL query parameter (persists in localStorage after first visit)

Append `?debugLogging=1` to any page URL:
```
http://localhost:27015/?debugLogging=1
```
This sets a localStorage key and stays enabled for subsequent reloads until explicitly disabled:
```
http://localhost:27015/?debugLogging=0
```

#### Option C — localStorage (manual, survives reloads)

In the browser console:
```js
localStorage.setItem('freemannotes.debugLogging', '1')
// then reload
location.reload()
```

To disable:
```js
localStorage.setItem('freemannotes.debugLogging', '0')
location.reload()
```

**Where to find the logs:**

- Server writes to `freeman-debug.log` in the project root (when `DEBUG_LOGGING=1`).
- Client events are batched and POSTed to `/api/debug-log` every ~400 ms.

---

### 2. Masonry Layout Debug System

**What it covers:** The note card grid layout engine — every repack decision, column assignment, card height measurement, drag-drop event, checklist expand/collapse, and viewport anchor calculation.

This is the primary tool for investigating layout bugs such as cards jumping columns or unbalanced columns after drag-drop.

**How to enable:**

#### In development (`npm run dev`)

In the browser console, set the flag then reload:
```js
window.__noteGridDebug = true
```
This must be set before the events you want to capture, as the flag is read at the time each event fires.

#### In production (`npm start`) — or any build

```js
localStorage.setItem('__ngDebug', '1')
location.reload()
```

This works in any build. After reload, all masonry events are recorded in memory until you call a retrieval command or reload again.

To disable:
```js
localStorage.removeItem('__ngDebug')
location.reload()
```

**Retrieval commands** (run in the browser console after triggering the issue):

| Command | Returns |
|---|---|
| `window.__ngImportant()` | Full debug payload as a JS object (inspectable in DevTools) |
| `window.__ngImportantText()` | Same payload as a formatted JSON string (copy-paste ready) |
| `window.__noteGridDebugDownloadImportant()` | Downloads a `.json` file to your device |
| `window.__noteGridDebugSummary()` | Current snapshot of grid state (no event history) |
| `window.__ngReset()` | Clears the in-memory event log (useful before reproducing a bug) |

**What the payload contains:**

- `recentImportantEvents` — chronological log of layout events, each with a timestamp and structured data. Key event types:
  - `REPACK_START` / `REPACK_END` — every layout recalculation, including which column each note was placed in and its measured height
  - `REPACK_REASON` — what triggered the recalculation (`drag-drop`, `measured-card-height`, `checklist-expand`, etc.)
  - `COLUMN_ASSIGNMENT_CHANGED` — a note moved to a different column
  - `COLUMN_SWAP` — two notes exchanged columns
  - `CHECKLIST_EXPAND` / `CHECKLIST_COLLAPSE` — a completed-items section was toggled, with the note ID
  - `DRAG_START` / `DRAG_END` — drag-drop lifecycle
  - `VIEWPORT_STABILITY_OVERRIDE` — a note was kept in its column because it was visible in the viewport
  - `STICKY_COLUMNS_SET` / `STICKY_COLUMNS_REJECTED` — column pinning after drag-drop
- `summary.noteColumnAssignments` — current column index for every note ID
- `summary.noteMeasuredHeights` — last measured pixel height for every note ID
- `summary.columnHeightsBefore` / `columnHeightsAfter` — column heights immediately before and after the last repack
- `liveState` — live snapshot of grid state at the time of the call

**Recommended workflow for intermittent bugs:**

1. Enable debug mode via localStorage (works in production):
   ```js
   localStorage.setItem('__ngDebug', '1'); location.reload()
   ```
2. Use the app normally until the layout issue appears.
3. **Immediately** after the issue appears, run:
   ```js
   window.__noteGridDebugDownloadImportant()
   ```
   This downloads the full event log before you do anything else.
4. Attach the downloaded JSON to your bug report.

---

### 3. Masonry Visual Overlay

**What it covers:** A live on-screen HUD showing real-time column heights, note positions, repack count, and placement decisions directly on top of the grid. Useful when actively working on layout algorithm changes.

**How to enable** (dev build only):

```js
window.__noteGridDebugOverlay = true
```

No reload is needed — the overlay appears within ~250 ms. To hide it, set the flag to `false` or reload without it.

> **Note:** This overlay is only available in development builds (`npm run dev`). It is stripped from production bundles.

---

### 4. Workspace Move Tracing

**What it covers:** End-to-end tracing for note moves between workspaces, including the optimistic client move, the server-side move transaction, and follow-up media/collaborator access requests.

**How to enable:**

#### Option A — URL query parameter (recommended during live repros)

Append `?moveDebug=1` to the app URL before reproducing the move:

```
http://localhost:27015/?moveDebug=1
```

Equivalent query aliases also work:

- `?debugMove=1`
- `?moveTrace=1`

The flag is copied into localStorage so it stays enabled across reloads until you disable it.

#### Option B — localStorage (manual, survives reloads)

In the browser console:

```js
localStorage.setItem('freemannotes.moveDebug', '1')
location.reload()
```

**How to disable:**

Use either of these:

```js
localStorage.setItem('freemannotes.moveDebug', '0')
location.reload()
```

or append `?moveDebug=0` to the URL once.

**What you should see:**

- The browser console prints a `[move-debug] trace started` message.
- That log includes a `traceId` and a `traceUrl` like `/api/debug/move-trace?traceId=...`.
- Subsequent move phases are logged as `[move-debug] ...` console entries while the trace is enabled.

**How to retrieve the trace:**

1. Reproduce the move issue with tracing enabled.
2. Copy the `traceUrl` from the initial console log.
3. Open that URL while authenticated, or fetch it from DevTools / your browser.
4. Save the returned JSON and include it with the bug report.

**What the trace contains:**

- Client-side move phases such as `move-start`, `local-move-complete`, `server-move-error`, and `rollback-start`
- Server-side phases such as `move-preflight`, `move-doc-state`, `move-related-state`, `move-success`, and `move-error`
- Related follow-up checks such as note-media access and collaborator snapshot requests

---

## Reporting a Layout Bug

When reporting a masonry layout issue (cards in the wrong column, column imbalance, cards jumping after drag-drop), please include:

1. **Debug payload** — captured immediately after the issue appears using `window.__noteGridDebugDownloadImportant()` (see [Masonry Layout Debug System](#2-masonry-layout-debug-system) above)
2. **Device and viewport** — device type (desktop/tablet/phone), approximate screen width, browser
3. **Steps to reproduce** — what you did before the issue appeared (e.g., "dragged card A over card B, then expanded the completed items section on card C")
4. **How reliably it reproduces** — every time, intermittently, or only after a specific sequence

---

## Native Platform Companions

The `platforms/` directory contains companion utilities for Android, iOS, and browsers. These are **not ports of the full notes app**. They are lightweight clipboard conversion tools that integrate with each platform's native share/selection system and allow users to convert copied text between Markdown and Rich Text formats.

```
platforms/
  android/          — Android text-selection action (Kotlin)
  ios/              — iOS Share Extension (Swift)
  browser-extension/— Chrome/Firefox extension (MV3)
  shared/           — TypeScript entry point for the shared JS bundle
```

### Architecture overview

All conversion logic lives in one place: `src/core/clipboardConversion.ts`. It is framework-agnostic TypeScript with no DOM dependency.

Each native platform runs this logic through an embedded WebView (Android) or WKWebView (iOS). The flow on every platform is identical:

1. **Get text** — receive the selected or shared text from the OS
2. **Run converter** — call `globalThis.FreemanClipboardConverter` inside the WebView using the bundled JS artifact
3. **Write clipboard** — put the converted Markdown or Rich Text result onto the system clipboard

Platform code is intentionally thin. If it does more than those three steps, it belongs in the shared TypeScript instead.

### Building the shared JS bundle

Before building any native app you need to produce the standalone JavaScript bundle that the WebView loads. The entry point is `platforms/shared/clipboard-converter-global.ts`, which re-exports the functions from `src/core/clipboardConversion.ts` and attaches them to `globalThis.FreemanClipboardConverter`.

Use any bundler that can produce a self-contained IIFE or ESM file from TypeScript. With esbuild:

```bash
npx esbuild platforms/shared/clipboard-converter-global.ts \
  --bundle \
  --format=iife \
  --outfile=clipboard-converter.bundle.js
```

The output file (`clipboard-converter.bundle.js`) must then be placed in each platform's asset directory before building that platform:

| Platform | Asset path |
|---|---|
| Android | `platforms/android/app/src/main/assets/clipboard-converter.bundle.js` |
| iOS | Add to the Xcode target as a bundle resource; load via `Bundle.main.path(forResource:ofType:)` |
| Browser extension | Bundle directly into `background.js` (or load as a separate asset) |

### Android

**Requirements:**
- Android Studio (Hedgehog or later recommended)
- Android SDK — minimum API level 23 (Android 6.0) for the `PROCESS_TEXT` intent; WebView is bundled with the OS
- Kotlin (handled automatically by Gradle)

**What the app does:**

Registers two activities (`CopyMarkdownActivity`, `CopyRichTextActivity`) that appear in the Android text-selection popup ("Copy Markdown" / "Copy Rich Text") whenever the user long-presses text in any app. Each activity:

1. Receives the selected text via `Intent.EXTRA_PROCESS_TEXT`
2. Loads `clipboard-converter.bundle.js` from the APK's assets into a headless `WebView`
3. Calls `FreemanClipboardConverter.prepareConvertedClipboardPayload(...)` via `evaluateJavascript`
4. Writes the result to the system clipboard and finishes

**Build steps:**

1. Generate the bundle (see [Building the shared JS bundle](#building-the-shared-js-bundle)) and copy it to `platforms/android/app/src/main/assets/`.
2. Open `platforms/android/` in Android Studio.
3. Sync Gradle (`File → Sync Project with Gradle Files`).
4. Run on a physical device or emulator (`Run → Run 'app'`).

To test: open any app with selectable text, long-press a word, tap the overflow (⋮) in the toolbar, and "Copy Markdown" / "Copy Rich Text" should appear.

**Package:** `com.freemannotes.clipboard`

### iOS

**Requirements:**
- macOS with Xcode 15 or later
- An Apple Developer account (free tier is sufficient for device testing via Xcode)
- iOS 14+ deployment target (uses `UIKit`, `WKWebView`, `UniformTypeIdentifiers`)
- Swift (no Objective-C)

**What the app does:**

Implements a **Share Extension** (`ClipboardConvertExtension`) that appears in the iOS Share Sheet when sharing or selecting text. The extension:

1. Receives the shared text via the extension context's input items
2. Loads a hidden `WKWebView` and injects `clipboard-converter.bundle.js`
3. Presents two buttons: "Copy Markdown" and "Copy Rich Text"
4. On tap, calls the appropriate converter function via `evaluateJavaScript`, writes the result to `UIPasteboard.general`, and dismisses

**Build steps:**

1. Generate the bundle (see [Building the shared JS bundle](#building-the-shared-js-bundle)).
2. Open `platforms/ios/` in Xcode (or create an Xcode project targeting the `ClipboardConvertExtension` directory).
3. Add `clipboard-converter.bundle.js` to the extension target's bundle resources (drag into the Xcode project and ensure "Copy items if needed" and the extension target are checked).
4. Set the deployment target and signing team in the target settings.
5. Build and run on a simulator or device.

To test: share text from Safari or Notes to the extension, or long-press text and choose "Share…".

**No server dependency.** The extension runs fully offline. It never contacts the Freeman Notes backend.

### Browser extension

**Requirements:**
- Chrome, Edge, or any Chromium browser (Manifest V3); or Firefox with MV3 support
- No build step required for the extension shell itself — `background.js` and `content-script.js` are plain JavaScript files

**What the extension does:**

Adds "Copy Markdown" and "Copy Rich Text" items to the browser right-click context menu on any selected text. The `background.js` service worker handles the context menu events; `content-script.js` runs in page context to access the selection's HTML (needed for Rich Text conversion).

**Load the extension in Chrome for development:**

1. Generate the bundle if you need updated conversion logic and include it in `background.js` or load it as an importable module.
2. Go to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `platforms/browser-extension/`.

The extension will appear immediately. Right-click any selected text on a webpage to see the "Copy Markdown" / "Copy Rich Text" menu items.

**Permissions used:** `contextMenus`, `activeTab`, `scripting`, `clipboardWrite`.

### Adding or changing conversion logic

All conversion behavior — Markdown rendering, Rich Text → Markdown, format detection — lives in `src/core/clipboardConversion.ts` and its dependencies in `src/core/`. Editing that file automatically affects all three platforms on the next bundle build.

The shared entry point (`platforms/shared/clipboard-converter-global.ts`) only re-exports the public API. It should not contain logic.

If you add a new conversion function:
1. Export it from `src/core/clipboardConversion.ts`
2. Add it to the `api` object in `platforms/shared/clipboard-converter-global.ts`
3. Rebuild the bundle
4. Update each platform to call the new function if needed

---

## Running Tests

```bash
npm test
```

Tests live in the `tests/` directory. The test runner is Node's built-in `node:test`.
