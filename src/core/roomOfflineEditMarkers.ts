/**
 * Which individual rooms are believed to hold local edits the server hasn't seen yet.
 *
 * This is the per-room twin of `workspaceOfflineEditMarkers.ts`, and it exists because of a
 * hole that opens the moment we stop giving every note its own WebSocket.
 *
 * The workspace-level marker is enough when every room in the active workspace is connected:
 * the workspace gets marked, its rooms all sync, the marker clears, and nothing is left
 * owing. Once sockets are only opened for notes you are actually looking at, that stops
 * holding. The active workspace's marker is cleared as soon as its registry syncs (see
 * `onSync` in DocumentManager), which can easily happen while a note you edited offline sits
 * off-screen with no socket and no prospect of one. Its edits would then live in IndexedDB
 * forever, invisible, until something incidentally opened that room — and "your edit is
 * still on the device, it just never left" is the worst kind of data bug: nothing is lost,
 * nothing is wrong on screen, and the other person simply never sees it.
 *
 * So: mark a room the moment a local edit lands on it with no live connection to push it,
 * clear it the moment that room syncs, and treat a marked room as always worth a socket
 * regardless of where it is on screen. The set is normally empty, and anything in it is
 * something we owe the server.
 *
 * `initialised` is the upgrade guard, same reasoning as the workspace version. On the first
 * boot after this ships nobody has ever written a room marker, and "no markers" would be
 * indistinguishable from "nothing to send" — which would strand any edit made offline
 * *before* the feature existed behind a socket that now never opens. So an uninitialised
 * store means "connect everything, the old way", exactly once. One slow boot is a fair price
 * for not silently orphaning an edit during the upgrade.
 *
 * Room names are stored whole (`workspaceId:noteId`), so this needs no workspace scoping of
 * its own. Deliberately not keyed by user, for the same reason as the workspace version:
 * threading a userId into DocumentManager, which has no business knowing one. Cleared on
 * logout alongside the other device caches.
 */

const STORAGE_KEY = 'freemannotes.roomOfflineEdits.v1';

type MarkerState = {
	initialised: boolean;
	roomNames: string[];
};

const EMPTY: MarkerState = { initialised: false, roomNames: [] };

// The handler that calls markRoomOfflineEdit runs on every local transaction, so a
// localStorage read per keystroke is not acceptable. Cache the parsed state and keep it in
// step with our own writes; nothing else in the app touches this key.
let cached: MarkerState | null = null;

function read(): MarkerState {
	if (cached) return cached;
	if (typeof localStorage === 'undefined') return EMPTY;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			cached = EMPTY;
			return cached;
		}
		const parsed = JSON.parse(raw) as Partial<MarkerState> | null;
		if (!parsed || typeof parsed !== 'object') {
			cached = EMPTY;
			return cached;
		}
		cached = {
			initialised: parsed.initialised === true,
			roomNames: Array.isArray(parsed.roomNames)
				? parsed.roomNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
				: [],
		};
		return cached;
	} catch {
		cached = EMPTY;
		return cached;
	}
}

function write(state: MarkerState): void {
	cached = state;
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Best effort. Losing a marker costs a deferred sync, not data — the edits are still
		// in IndexedDB and go out the next time that room is opened. The in-memory cache above
		// still carries it for the rest of this session, which covers the common case of
		// storage being full rather than unavailable.
	}
}

/** True when the caller should fall back to connecting every room, the pre-laziness way. */
export function isRoomOfflineEditTrackingInitialised(): boolean {
	return read().initialised;
}

/** Called once a boot has connected everything, so later boots can trust the markers. */
export function markRoomOfflineEditTrackingInitialised(): void {
	const state = read();
	if (state.initialised) return;
	write({ ...state, initialised: true });
}

export function readRoomsWithOfflineEdits(): string[] {
	return read().roomNames;
}

export function hasRoomOfflineEdit(roomName: string): boolean {
	const name = String(roomName || '').trim();
	if (!name) return false;
	return read().roomNames.includes(name);
}

/**
 * A local edit landed on this room with no live connection to push it.
 *
 * Called from DocumentManager's transaction handler, so it must stay cheap — it early-returns
 * on the common case of an already-marked room without touching storage at all.
 */
export function markRoomOfflineEdit(roomName: string): void {
	const name = String(roomName || '').trim();
	if (!name) return;
	const state = read();
	if (state.roomNames.includes(name)) return;
	write({ initialised: state.initialised, roomNames: [...state.roomNames, name] });
}

/** Those edits have gone out — this room completed a sync. */
export function clearRoomOfflineEdit(roomName: string): void {
	const name = String(roomName || '').trim();
	if (!name) return;
	const state = read();
	if (!state.roomNames.includes(name)) return;
	write({
		initialised: state.initialised,
		roomNames: state.roomNames.filter((candidate) => candidate !== name),
	});
}

/** Must be called on logout — the next user on this device has no business seeing these. */
export function clearRoomOfflineEditMarkers(): void {
	cached = null;
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}

/** Test seam. Drops the in-memory cache so a fresh read hits storage again. */
export function resetRoomOfflineEditMarkerCacheForTests(): void {
	cached = null;
}
