/**
 * Opt-in instrumentation for collapsible heading collapse jitter analysis.
 *
 * Enable in devtools console:
 *   window.__enableHeadingCollapseDebug()
 *   // or: localStorage.setItem('__headingCollapseDebug', '1') then reload
 *   localStorage.setItem('__ngDebug', '1')  // optional: grid debug overlay + repack counts
 *
 * After reproducing a collapse, inspect:
 *   window.__printHeadingCollapseDebugSummary()
 *   window.__headingCollapseDebugSessions
 */

export type HeadingCollapseDebugCounts = {
	decorationRefresh: number;
	resizeObserver: number;
	noteMeasure: number;
	heightVersionBump: number;
	repackStart: number;
	repackEnd: number;
	reactRenderNoteCard: number;
	reactRenderRichTextEditor: number;
	richHeadingToggleEvent: number;
	prefNotify: number;
	animationRefreshEvent: number;
};

export type HeadingCollapseDebugSession = {
	id: string;
	noteId: string;
	collapseId: string;
	direction: 'collapse' | 'expand';
	startedAt: number;
	endedAt: number | null;
	blockCount: number;
	hasFollowingHeading: boolean;
	noteContainerHeightBefore: number | null;
	noteContainerHeightAfter: number | null;
	counts: HeadingCollapseDebugCounts;
	events: Array<{ t: number; type: string; data?: Record<string, unknown> }>;
};

const STORAGE_KEY = '__headingCollapseDebug';

let activeSession: HeadingCollapseDebugSession | null = null;
const sessions: HeadingCollapseDebugSession[] = [];

function emptyCounts(): HeadingCollapseDebugCounts {
	return {
		decorationRefresh: 0,
		resizeObserver: 0,
		noteMeasure: 0,
		heightVersionBump: 0,
		repackStart: 0,
		repackEnd: 0,
		reactRenderNoteCard: 0,
		reactRenderRichTextEditor: 0,
		richHeadingToggleEvent: 0,
		prefNotify: 0,
		animationRefreshEvent: 0,
	};
}

export function isHeadingCollapseDebugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return localStorage.getItem(STORAGE_KEY) === '1';
	} catch {
		return false;
	}
}

function logEvent(type: string, data?: Record<string, unknown>): void {
	if (!isHeadingCollapseDebugEnabled()) return;
	const session = activeSession;
	const entry = { t: performance.now(), type, data };
	if (session) {
		session.events.push(entry);
	}
	// eslint-disable-next-line no-console
	console.debug('[heading-collapse-debug]', type, data ?? {});
}

export function measureNoteContainerHeight(anchor: Element | null | undefined): number | null {
	if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return null;
	const card = anchor.closest('[data-note-id]') as HTMLElement | null;
	const shell = card ?? (anchor.closest('[class*="noteEditor"]') as HTMLElement | null);
	const target = shell ?? anchor;
	const height = Math.round(target.getBoundingClientRect().height);
	return height > 0 ? height : null;
}

export function beginHeadingCollapseDebugSession(args: {
	noteId: string;
	collapseId: string;
	direction: 'collapse' | 'expand';
	blockCount: number;
	hasFollowingHeading: boolean;
	noteContainerHeightBefore: number | null;
}): void {
	if (!isHeadingCollapseDebugEnabled()) return;
	activeSession = {
		id: `${args.noteId}::${args.collapseId}::${Date.now()}`,
		noteId: args.noteId,
		collapseId: args.collapseId,
		direction: args.direction,
		startedAt: performance.now(),
		endedAt: null,
		blockCount: args.blockCount,
		hasFollowingHeading: args.hasFollowingHeading,
		noteContainerHeightBefore: args.noteContainerHeightBefore,
		noteContainerHeightAfter: null,
		counts: emptyCounts(),
		events: [],
	};
	logEvent('HEADING_COLLAPSE_START', {
		noteId: args.noteId,
		collapseId: args.collapseId,
		direction: args.direction,
		blockCount: args.blockCount,
		hasFollowingHeading: args.hasFollowingHeading,
		noteContainerHeightBefore: args.noteContainerHeightBefore,
	});
}

export function endHeadingCollapseDebugSession(args?: {
	noteContainerHeightAfter?: number | null;
	reason?: string;
}): void {
	if (!isHeadingCollapseDebugEnabled() || !activeSession) return;
	activeSession.endedAt = performance.now();
	if (args?.noteContainerHeightAfter != null) {
		activeSession.noteContainerHeightAfter = args.noteContainerHeightAfter;
	}
	logEvent('HEADING_COLLAPSE_END', {
		durationMs: activeSession.endedAt - activeSession.startedAt,
		noteContainerHeightAfter: activeSession.noteContainerHeightAfter,
		reason: args?.reason ?? null,
		counts: { ...activeSession.counts },
	});
	sessions.push(activeSession);
	if (sessions.length > 20) sessions.shift();
	activeSession = null;
}

export function recordHeadingCollapseDebug(
	kind: keyof HeadingCollapseDebugCounts,
	data?: Record<string, unknown>,
): void {
	if (!isHeadingCollapseDebugEnabled()) return;
	if (activeSession) {
		activeSession.counts[kind] += 1;
	}
	logEvent(kind, data);
}

export function getHeadingCollapseDebugSessions(): readonly HeadingCollapseDebugSession[] {
	return sessions;
}

export function getActiveHeadingCollapseDebugSession(): HeadingCollapseDebugSession | null {
	return activeSession;
}

export function printHeadingCollapseDebugSummary(): void {
	if (!isHeadingCollapseDebugEnabled()) {
		// eslint-disable-next-line no-console
		console.info('[heading-collapse-debug] disabled — set localStorage.__headingCollapseDebug = "1"');
		return;
	}
	const latest = sessions[sessions.length - 1] ?? activeSession;
	if (!latest) {
		// eslint-disable-next-line no-console
		console.info('[heading-collapse-debug] no sessions recorded yet');
		return;
	}
	// eslint-disable-next-line no-console
	console.table([{
		id: latest.id,
		direction: latest.direction,
		blockCount: latest.blockCount,
		hasFollowingHeading: latest.hasFollowingHeading,
		durationMs: latest.endedAt != null ? latest.endedAt - latest.startedAt : null,
		heightBefore: latest.noteContainerHeightBefore,
		heightAfter: latest.noteContainerHeightAfter,
		...latest.counts,
	}]);
	// eslint-disable-next-line no-console
	console.info('[heading-collapse-debug] full event log:', latest.events);
}

declare global {
	interface Window {
		__headingCollapseDebugSessions?: readonly HeadingCollapseDebugSession[];
		__printHeadingCollapseDebugSummary?: () => void;
		__enableHeadingCollapseDebug?: () => void;
		__headingCollapseDebugEnabled?: () => boolean;
	}
}

export function installHeadingCollapseDebugConsole(): void {
	if (typeof window === 'undefined') return;
	window.__printHeadingCollapseDebugSummary = printHeadingCollapseDebugSummary;
	window.__enableHeadingCollapseDebug = (): void => {
		try {
			localStorage.setItem(STORAGE_KEY, '1');
		} catch {
			// ignore
		}
		// eslint-disable-next-line no-console
		console.info('[heading-collapse-debug] enabled. Collapse a heading, wait for animation to finish (~300ms), then run __printHeadingCollapseDebugSummary()');
	};
	window.__headingCollapseDebugEnabled = isHeadingCollapseDebugEnabled;
	Object.defineProperty(window, '__headingCollapseDebugSessions', {
		get: () => [...sessions],
		configurable: true,
	});
	if (isHeadingCollapseDebugEnabled()) {
		// eslint-disable-next-line no-console
		console.info('[heading-collapse-debug] active — use __printHeadingCollapseDebugSummary() after reproducing a collapse');
	}
}

if (typeof window !== 'undefined') {
	installHeadingCollapseDebugConsole();
}
