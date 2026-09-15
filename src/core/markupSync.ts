// Device bookkeeping for PDF markup. The Yjs docs themselves live in the viewer's lazy chunk
// (components/NoteDocuments/markup/markupStore.ts); this small core module is what the rest of the
// app can use without loading the PDF viewer:
//
// - which document versions have a markup copy in IndexedDB on this device, and which of those
//   have changes the server hasn't had yet (drawn offline, or while the connection was down);
// - uploading those waiting changes in the background after sign-in and when the network comes
//   back, so markup drawn on a plane gets to the office without anyone reopening the PDF;
// - clearing it all on sign-out. Once markup syncs, the server holds the real copy, so nothing of
//   it should stay readable on a shared device (plan decision 2). Sign-out warns first if
//   something is still waiting to upload, because it would be lost.

const REGISTRY_KEY = 'freemannotes.markupDevice.v1';
const MARKUP_DB_PREFIX = 'freemannotes-markup:';
const REGISTRY_EVENT = 'freemannotes:markup-registry';
/** Fired on sign-out so open markup docs close their IndexedDB connections before the delete. */
export const MARKUP_LOGOUT_EVENT = 'freemannotes:markup-logout';
// Same settle delay the document sync uses: DNS and TLS can lag the online event.
const ONLINE_SETTLE_MS = 2500;

type MarkupRegistry = Record<string, { unsynced: boolean; touchedAt: number }>;

function readRegistry(): MarkupRegistry {
	try {
		const parsed = JSON.parse(window.localStorage.getItem(REGISTRY_KEY) || 'null') as MarkupRegistry | null;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function writeRegistry(registry: MarkupRegistry): void {
	try {
		window.localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
	} catch {
		// Storage blocked: the flags just don't survive a reload.
	}
	window.dispatchEvent(new Event(REGISTRY_EVENT));
}

export function markupDatabaseName(versionId: string): string {
	return `${MARKUP_DB_PREFIX}${versionId}`;
}

/** Notes that this device holds a markup copy for the version, so sign-out knows to delete it. */
export function rememberMarkupVersion(versionId: string): void {
	if (typeof window === 'undefined') return;
	const registry = readRegistry();
	if (registry[versionId]) return;
	registry[versionId] = { unsynced: false, touchedAt: Date.now() };
	writeRegistry(registry);
}

export function setMarkupUnsynced(versionId: string, unsynced: boolean): void {
	if (typeof window === 'undefined') return;
	const registry = readRegistry();
	if (registry[versionId]?.unsynced === unsynced) return;
	registry[versionId] = { unsynced, touchedAt: Date.now() };
	writeRegistry(registry);
}

export function isMarkupUnsynced(versionId: string): boolean {
	if (typeof window === 'undefined') return false;
	return readRegistry()[versionId]?.unsynced === true;
}

export function listUnsyncedMarkupVersions(): string[] {
	if (typeof window === 'undefined') return [];
	return Object.entries(readRegistry())
		.filter(([, entry]) => entry && entry.unsynced)
		.map(([versionId]) => versionId);
}

export function hasUnsyncedMarkup(): boolean {
	return listUnsyncedMarkupVersions().length > 0;
}

export function subscribeMarkupRegistry(listener: () => void): () => void {
	if (typeof window === 'undefined') return () => undefined;
	window.addEventListener(REGISTRY_EVENT, listener);
	return () => window.removeEventListener(REGISTRY_EVENT, listener);
}

// ── Background upload ──────────────────────────────────────────────────────

let backgroundWebsocketUrl: string | null = null;
let onlineListener: (() => void) | null = null;
let onlineTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight: Promise<void> | null = null;

/** Sends every version's waiting markup changes to the server, one at a time. */
export function flushUnsyncedMarkup(): Promise<void> {
	const websocketUrl = backgroundWebsocketUrl;
	if (!websocketUrl || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
	if (flushInFlight) return flushInFlight;
	const versions = listUnsyncedMarkupVersions();
	if (versions.length === 0) return Promise.resolve();
	flushInFlight = (async () => {
		// The viewer chunk owns the markup docs; it's only loaded when there's something to send.
		const { syncMarkupVersionInBackground } = await import('../components/NoteDocuments/markup/markupStore');
		for (const versionId of versions) {
			if (backgroundWebsocketUrl !== websocketUrl) return;
			await syncMarkupVersionInBackground(versionId, websocketUrl).catch(() => false);
		}
	})()
		.catch((error) => {
			console.warn('[markup] background upload failed', error);
		})
		.finally(() => {
			flushInFlight = null;
		});
	return flushInFlight;
}

export function startMarkupBackgroundSync(websocketUrl: string): void {
	if (typeof window === 'undefined' || !websocketUrl) return;
	backgroundWebsocketUrl = websocketUrl;
	if (!onlineListener) {
		onlineListener = () => {
			if (onlineTimer !== null) clearTimeout(onlineTimer);
			onlineTimer = setTimeout(() => {
				onlineTimer = null;
				void flushUnsyncedMarkup();
			}, ONLINE_SETTLE_MS);
		};
		window.addEventListener('online', onlineListener);
	}
	void flushUnsyncedMarkup();
}

export function stopMarkupBackgroundSync(): void {
	backgroundWebsocketUrl = null;
	if (onlineTimer !== null) {
		clearTimeout(onlineTimer);
		onlineTimer = null;
	}
	if (onlineListener && typeof window !== 'undefined') {
		window.removeEventListener('online', onlineListener);
		onlineListener = null;
	}
}

// ── Sign-out ───────────────────────────────────────────────────────────────

function deleteDatabase(name: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const request = indexedDB.deleteDatabase(name);
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			// Still deleted once the last connection closes; nothing to wait for here.
			request.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}

export async function clearMarkupDeviceDataForLogout(): Promise<void> {
	if (typeof window === 'undefined') return;
	stopMarkupBackgroundSync();
	window.dispatchEvent(new Event(MARKUP_LOGOUT_EVENT));
	const names = new Set(Object.keys(readRegistry()).map(markupDatabaseName));
	try {
		// Also catches copies made before this bookkeeping existed.
		if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
			for (const database of await indexedDB.databases()) {
				if (database.name && database.name.startsWith(MARKUP_DB_PREFIX)) names.add(database.name);
			}
		}
	} catch {
		// Not supported everywhere; the registry covers what this device has opened since.
	}
	try {
		window.localStorage.removeItem(REGISTRY_KEY);
	} catch {
		// Ignore.
	}
	window.dispatchEvent(new Event(REGISTRY_EVENT));
	if (typeof indexedDB === 'undefined') return;
	await Promise.all(Array.from(names).map(deleteDatabase));
}
