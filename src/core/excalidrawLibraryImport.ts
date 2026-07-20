// Cross-tab relay for Excalidraw library imports.
//
// When the user clicks "Browse libraries" → picks a library → "Add to Excalidraw",
// the Excalidraw library site opens a NEW tab at:
//   https://<our-app>/#addLibrary=<url>&token=<token>
//
// That new tab has no drawing editor mounted, so Excalidraw's own hashchange
// listener never fires.  This module bridges the gap:
//   1. App.tsx detects #addLibrary= on startup/hashchange in the new tab.
//   2. It stores the URL in localStorage and broadcasts it via BroadcastChannel.
//   3. DrawingEditor.tsx (in the original tab) receives the broadcast and
//      re-triggers the #addLibrary= hash on its own window so Excalidraw's
//      built-in handler takes over.

export const EXCALIDRAW_LIBRARY_CHANNEL = 'freemannotes.excalidraw.library.v1';
export const EXCALIDRAW_LIBRARY_PENDING_KEY = 'freemannotes.pendingLibraryImport.v1';

export type LibraryImportMsg = {
	libraryUrl: string;
	token: string | null;
};

export function parseLibraryImportFromHash(): LibraryImportMsg | null {
	if (typeof window === 'undefined') return null;
	try {
		const params = new URLSearchParams(window.location.hash.slice(1));
		const libraryUrl = params.get('addLibrary');
		if (!libraryUrl) return null;
		return { libraryUrl, token: params.get('token') };
	} catch {
		return null;
	}
}

export function storeLibraryImport(msg: LibraryImportMsg): void {
	try {
		localStorage.setItem(EXCALIDRAW_LIBRARY_PENDING_KEY, JSON.stringify(msg));
	} catch { /* ignore */ }
}

export function consumeStoredLibraryImport(): LibraryImportMsg | null {
	try {
		const raw = localStorage.getItem(EXCALIDRAW_LIBRARY_PENDING_KEY);
		if (!raw) return null;
		localStorage.removeItem(EXCALIDRAW_LIBRARY_PENDING_KEY);
		const parsed = JSON.parse(raw) as Partial<LibraryImportMsg>;
		if (typeof parsed?.libraryUrl !== 'string') return null;
		return { libraryUrl: parsed.libraryUrl, token: parsed.token ?? null };
	} catch {
		return null;
	}
}

export function broadcastLibraryImport(msg: LibraryImportMsg): void {
	try {
		const ch = new BroadcastChannel(EXCALIDRAW_LIBRARY_CHANNEL);
		ch.postMessage(msg);
		// Close after a short delay so the message definitely sends.
		setTimeout(() => ch.close(), 1000);
	} catch { /* BroadcastChannel not supported */ }
}

export function subscribeLibraryImport(cb: (msg: LibraryImportMsg) => void): () => void {
	try {
		const ch = new BroadcastChannel(EXCALIDRAW_LIBRARY_CHANNEL);
		ch.onmessage = (e: MessageEvent<LibraryImportMsg>) => {
			if (e.data?.libraryUrl) cb(e.data);
		};
		return () => ch.close();
	} catch {
		return () => {};
	}
}
