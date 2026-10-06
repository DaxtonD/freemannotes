/**
 * A tiny shared ring buffer in localStorage, behind the service-worker debug toggle in
 * Preferences, read by the same "Copy log" button.
 *
 * It exists because reasoning about this app's behaviour from the source alone has repeatedly
 * produced confident, wrong answers — the PWA reload argument took two days of guessing and one
 * afternoon of logging. Anything with a timing, focus or lifecycle component should write here
 * rather than be deduced.
 *
 * Shares a key with the PWA log on purpose: one buffer means one chronological story, and the
 * existing copy button picks everything up with no new interface.
 */

const DEBUG_ENABLED_KEY = 'freemannotes.pwa.debug-enabled.v1';
const DEBUG_LOG_KEY = 'freemannotes.pwa.debug-log.v1';
const DEBUG_MAX_ENTRIES = 150;

export type DebugLogEntry = { t: string; e: string; d?: Record<string, unknown> };

export function isDebugLogEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return window.localStorage.getItem(DEBUG_ENABLED_KEY) === '1';
	} catch {
		return false;
	}
}

export function debugLog(event: string, details?: Record<string, unknown>): void {
	if (typeof window === 'undefined') return;
	try {
		if (window.localStorage.getItem(DEBUG_ENABLED_KEY) !== '1') return;
		const raw = window.localStorage.getItem(DEBUG_LOG_KEY);
		const entries: DebugLogEntry[] = raw ? (JSON.parse(raw) as DebugLogEntry[]) : [];
		entries.push({ t: new Date().toISOString(), e: event, ...(details ? { d: details } : {}) });
		window.localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(entries.slice(-DEBUG_MAX_ENTRIES)));
	} catch {
		// Storage full, blocked, or private browsing. Losing a log line is not worth an error.
	}
}

/** The nearest ancestor that actually scrolls, so a scroll jump can be measured rather than felt. */
export function findScrollParent(element: HTMLElement | null): HTMLElement | null {
	let node: HTMLElement | null = element;
	while (node) {
		const style = window.getComputedStyle(node);
		const overflowY = style.overflowY;
		if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
		node = node.parentElement;
	}
	return null;
}

/**
 * Every plausible place a scroll position can live, because guessing wrong makes a real jump
 * read as zero movement. On this app the grid, the editor body and the document element are all
 * candidates depending on viewport and view, and visualViewport moves separately again when the
 * mobile keyboard opens. Pass the element whose nearest scroll container you care about; the rest
 * are measured regardless so nothing can hide.
 */
export function snapshotScrollState(scroller: HTMLElement | null): Record<string, unknown> {
	const doc = typeof document !== 'undefined' ? document.scrollingElement : null;
	const vv = typeof window !== 'undefined' ? window.visualViewport : null;
	return {
		scroller: scroller ? scroller.scrollTop : null,
		doc: doc ? doc.scrollTop : null,
		win: typeof window !== 'undefined' ? Math.round(window.scrollY) : null,
		vvTop: vv ? Math.round(vv.offsetTop) : null,
		vvHeight: vv ? Math.round(vv.height) : null,
	};
}

/** Names a scroll container well enough to tell whether it's the one that matters. */
export function describeScroller(scroller: HTMLElement | null): string | null {
	if (!scroller) return null;
	const classes = String(scroller.className || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
	return `${scroller.tagName.toLowerCase()}${classes ? '.' + classes : ''}`;
}

/**
 * Identifies whatever currently has focus, in terms that mean something here: the element's tag,
 * and which checklist row it sits inside (via the row's data attribute) if any.
 */
export function describeActiveElement(): Record<string, unknown> {
	if (typeof document === 'undefined') return { tag: null };
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return { tag: null };
	const row = active.closest('[data-checklist-row-id]');
	return {
		tag: active.tagName.toLowerCase(),
		editable: active.isContentEditable,
		rowId: row instanceof HTMLElement ? row.dataset.checklistRowId ?? null : null,
	};
}
