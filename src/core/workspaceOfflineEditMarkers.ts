/**
 * Which workspaces are believed to hold local edits the server hasn't seen yet.
 *
 * This exists to make app startup fast. `probeSession` used to, on EVERY boot, walk every
 * workspace with any local IndexedDB data and for each one: POST /activate, open an IndexedDB
 * provider for every room in it, open a WebSocket for every room in it, wait up to five
 * seconds, tear it all down — sequentially, with the active workspace's own sync held off the
 * whole time. Measured on a phone over Cloudflare: **23 seconds before the first note socket
 * was even allowed to start connecting**, of which ~15 s was this. The grid meanwhile showed
 * cached content at 347 ms and looked completely settled, so you sat there reading a stale
 * note for 24 s with no indication anything was pending. On desktop the same chain cost 10.5 s.
 *
 * The flush itself is worth having — it is what stops an offline edit in workspace B from
 * sitting on one device forever if you never open workspace B again. What was not worth having
 * is paying for it when there is nothing to send, which is nearly always.
 *
 * So: record a workspace here the moment a genuine local edit lands on one of its rooms while
 * that room has no live server connection, and clear it once those edits have demonstrably
 * gone out. Boot then flushes only the marked workspaces, and in the common case skips the
 * whole chain.
 *
 * `initialised` is the upgrade guard. On the very first boot after this shipped, nobody has
 * ever written a marker, and "no markers" would be indistinguishable from "nothing to send" —
 * which would silently skip a flush for edits made before the feature existed. So an
 * uninitialised store means "flush everything, the old way", exactly once.
 *
 * Deliberately NOT keyed by user. Workspace ids are all that's stored, the markers must
 * survive a page load, and the alternative is threading a userId through DocumentManager,
 * which has no business knowing one. Cleared on logout alongside the other device caches.
 */

const STORAGE_KEY = 'freemannotes.workspaceOfflineEdits.v1';

type MarkerState = {
	initialised: boolean;
	workspaceIds: string[];
};

const EMPTY: MarkerState = { initialised: false, workspaceIds: [] };

function read(): MarkerState {
	if (typeof localStorage === 'undefined') return EMPTY;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY;
		const parsed = JSON.parse(raw) as Partial<MarkerState> | null;
		if (!parsed || typeof parsed !== 'object') return EMPTY;
		return {
			initialised: parsed.initialised === true,
			workspaceIds: Array.isArray(parsed.workspaceIds)
				? parsed.workspaceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
				: [],
		};
	} catch {
		return EMPTY;
	}
}

function write(state: MarkerState): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Best effort. Losing a marker costs a deferred flush, not data — the edits are still
		// in IndexedDB and go out the next time that workspace is opened.
	}
}

/** True when startup should fall back to flushing every workspace with local data. */
export function isWorkspaceOfflineEditTrackingInitialised(): boolean {
	return read().initialised;
}

/** Called once startup has done its first full flush, so later boots can trust the markers. */
export function markWorkspaceOfflineEditTrackingInitialised(): void {
	const state = read();
	if (state.initialised) return;
	write({ ...state, initialised: true });
}

export function readWorkspacesWithOfflineEdits(): string[] {
	return read().workspaceIds;
}

/**
 * A local edit landed on a room of `workspaceId` with no live connection to push it. Called
 * from DocumentManager's transaction handler, so it must stay cheap — it early-returns on the
 * common case of an already-marked workspace without touching storage.
 */
export function markWorkspaceOfflineEdit(workspaceId: string): void {
	const id = String(workspaceId || '').trim();
	if (!id) return;
	const state = read();
	if (state.workspaceIds.includes(id)) return;
	write({ initialised: state.initialised, workspaceIds: [...state.workspaceIds, id] });
}

/** Those edits have gone out — either flushed at startup, or synced live while active. */
export function clearWorkspaceOfflineEdit(workspaceId: string): void {
	const id = String(workspaceId || '').trim();
	if (!id) return;
	const state = read();
	if (!state.workspaceIds.includes(id)) return;
	write({
		initialised: state.initialised,
		workspaceIds: state.workspaceIds.filter((candidate) => candidate !== id),
	});
}

/** Must be called on logout — the next user on this device has no business seeing these. */
export function clearWorkspaceOfflineEditMarkers(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// ignore
	}
}
