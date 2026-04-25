import type { ViewMode } from './viewMode';

// Lightweight localStorage snapshot of the last measured masonry layout for a
// workspace/view/device bucket. Used only as a startup hint until live DOM
// measurements replace it.
export type NoteGridLayoutRect = {
	noteId: string;
	x: number;
	y: number;
	width: number;
	height: number;
};

export type NoteGridLayoutSnapshot = {
	v: 1;
	workspaceId: string;
	viewMode: ViewMode;
	deviceType: 'mobile' | 'desktop';
	density: string;
	viewportBucket: string;
	columnCount: number;
	orderedIds: string[];
	columnSlots: number[] | null;
	rects: NoteGridLayoutRect[];
	savedAt: string;
};

export type NoteGridLayoutCacheScope = {
	workspaceId: string;
	viewMode: ViewMode;
	deviceType: 'mobile' | 'desktop';
	density: string;
	viewportBucket: string;
};

const VERSION = 1;
const KEY_PREFIX = 'layout:';

export function getLayoutDeviceType(viewportWidth: number): 'mobile' | 'desktop' {
	// Prefer UA hints when available, but keep a viewport-width fallback for older
	// browsers and desktop responsive debugging sessions.
	if (typeof navigator === 'undefined') return viewportWidth < 768 ? 'mobile' : 'desktop';
	const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
	if (nav.userAgentData?.mobile) return 'mobile';
	return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || viewportWidth < 768 ? 'mobile' : 'desktop';
}

export function getLayoutViewportBucket(viewportWidth: number, viewportHeight: number): string {
	const bucketWidth = Math.max(320, Math.round(viewportWidth / 160) * 160);
	const bucketHeight = Math.max(320, Math.round(viewportHeight / 160) * 160);
	return `${bucketWidth}x${bucketHeight}`;
}

export function makeNoteGridLayoutCacheKey(scope: NoteGridLayoutCacheScope): string {
	return `${KEY_PREFIX}${scope.workspaceId}:${scope.viewMode}:${scope.deviceType}:${scope.density}:${scope.viewportBucket}`;
}

export function readNoteGridLayoutSnapshot(scope: NoteGridLayoutCacheScope): NoteGridLayoutSnapshot | null {
	if (typeof window === 'undefined' || !scope.workspaceId) return null;
	try {
		const raw = window.localStorage.getItem(makeNoteGridLayoutCacheKey(scope));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<NoteGridLayoutSnapshot> | null;
		if (!parsed || parsed.v !== VERSION) return null;
		if (!Array.isArray(parsed.orderedIds)) return null;
		return {
			v: 1,
			workspaceId: String(parsed.workspaceId || ''),
			viewMode: String(parsed.viewMode || 'card') as ViewMode,
			deviceType: parsed.deviceType === 'mobile' ? 'mobile' : 'desktop',
			density: String(parsed.density || ''),
			viewportBucket: String(parsed.viewportBucket || ''),
			columnCount: Math.max(1, Number(parsed.columnCount || 1) || 1),
			orderedIds: parsed.orderedIds.map((id) => String(id || '')).filter(Boolean),
			columnSlots: Array.isArray(parsed.columnSlots)
				? parsed.columnSlots.map((value) => Math.max(0, Math.floor(Number(value) || 0)))
				: null,
			rects: Array.isArray(parsed.rects)
				? parsed.rects
					.map((rect) => ({
						noteId: String((rect as Partial<NoteGridLayoutRect>).noteId || ''),
						x: Number((rect as Partial<NoteGridLayoutRect>).x || 0),
						y: Number((rect as Partial<NoteGridLayoutRect>).y || 0),
						width: Number((rect as Partial<NoteGridLayoutRect>).width || 0),
						height: Number((rect as Partial<NoteGridLayoutRect>).height || 0),
					}))
					.filter((rect) => rect.noteId)
				: [],
			savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
		};
	} catch {
		return null;
	}
}

export function writeNoteGridLayoutSnapshot(scope: NoteGridLayoutCacheScope, snapshot: Omit<NoteGridLayoutSnapshot, 'v' | 'workspaceId' | 'viewMode' | 'deviceType' | 'density' | 'viewportBucket' | 'savedAt'>): void {
	if (typeof window === 'undefined' || !scope.workspaceId) return;
	try {
		// Round persisted rects so tiny subpixel differences do not create needless
		// cache churn across repeated measurements of the same settled layout.
		const payload: NoteGridLayoutSnapshot = {
			v: 1,
			workspaceId: scope.workspaceId,
			viewMode: scope.viewMode,
			deviceType: scope.deviceType,
			density: scope.density,
			viewportBucket: scope.viewportBucket,
			columnCount: Math.max(1, Number(snapshot.columnCount || 1) || 1),
			orderedIds: snapshot.orderedIds.map((id) => String(id || '')).filter(Boolean),
			columnSlots: Array.isArray(snapshot.columnSlots)
				? snapshot.columnSlots.map((value) => Math.max(0, Math.floor(Number(value) || 0)))
				: null,
			rects: snapshot.rects.map((rect) => ({
				noteId: String(rect.noteId || ''),
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
			})).filter((rect) => rect.noteId),
			savedAt: new Date().toISOString(),
		};
		window.localStorage.setItem(makeNoteGridLayoutCacheKey(scope), JSON.stringify(payload));
	} catch {
		// Best effort only.
	}
}