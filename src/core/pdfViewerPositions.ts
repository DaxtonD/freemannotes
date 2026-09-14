// Where you were in each PDF, so reopening it picks up at the same page. Per device (it's
// how far *you* read, not note data) and per login, so a shared device doesn't hand one
// person's reading position to the next. Cleared on logout along with the other caches.

const STORAGE_PREFIX = 'freemannotes.pdfViewerPositions.v1:';
const MAX_ENTRIES = 200;

export type PdfViewerPosition = {
	/** 1-based page number. */
	page: number;
	/** How far down that page (0 = top edge, 1 = bottom edge). */
	fraction: number;
	savedAt: number;
};

type PositionStore = Record<string, PdfViewerPosition>;

function storageKey(userId: string | null | undefined): string {
	return `${STORAGE_PREFIX}${userId || 'anonymous'}`;
}

function readStore(userId: string | null | undefined): PositionStore {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(storageKey(userId));
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PositionStore) : {};
	} catch {
		return {};
	}
}

export function readPdfViewerPosition(userId: string | null | undefined, documentKey: string): PdfViewerPosition | null {
	const entry = readStore(userId)[documentKey];
	if (!entry || !Number.isFinite(entry.page) || entry.page < 1) return null;
	return {
		page: Math.floor(entry.page),
		fraction: Number.isFinite(entry.fraction) ? Math.min(1, Math.max(0, entry.fraction)) : 0,
		savedAt: Number(entry.savedAt) || 0,
	};
}

export function writePdfViewerPosition(userId: string | null | undefined, documentKey: string, position: { page: number; fraction: number }): void {
	if (typeof window === 'undefined' || !documentKey) return;
	try {
		const store = readStore(userId);
		store[documentKey] = { page: position.page, fraction: position.fraction, savedAt: Date.now() };
		const keys = Object.keys(store);
		if (keys.length > MAX_ENTRIES) {
			keys.sort((left, right) => store[left].savedAt - store[right].savedAt);
			for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[key];
		}
		window.localStorage.setItem(storageKey(userId), JSON.stringify(store));
	} catch {
		// Storage full or blocked: the viewer just opens at page 1 next time.
	}
}

/** Called on logout. */
export function clearPdfViewerPositions(): void {
	if (typeof window === 'undefined') return;
	try {
		const keys: string[] = [];
		for (let index = 0; index < window.localStorage.length; index += 1) {
			const key = window.localStorage.key(index);
			if (key && key.startsWith(STORAGE_PREFIX)) keys.push(key);
		}
		for (const key of keys) window.localStorage.removeItem(key);
	} catch {
		// ignore
	}
}
