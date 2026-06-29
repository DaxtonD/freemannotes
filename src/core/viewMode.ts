/**
 * viewMode.ts – Persistent note-grid view mode management.
 *
 * Supports four view modes: card (masonry), list (compact rows),
 * strip (rows with content preview), and bubble (cross-workspace overview).
 *
 * The selected mode is persisted in localStorage so it survives page reloads.
 */

export type ViewMode = 'card' | 'list' | 'strip' | 'bubble' | 'inbox';

const STORAGE_KEY = 'fn_view_mode_v1';

// Inbox is excluded from the cycle — it's a dedicated navigation mode, not a grid variant.
const CYCLE_ORDER: ViewMode[] = ['card', 'list', 'strip', 'bubble'];

function isViewMode(value: unknown): value is ViewMode {
	return value === 'card' || value === 'list' || value === 'strip' || value === 'bubble' || value === 'inbox';
}

export function loadViewMode(): ViewMode {
	if (typeof window === 'undefined') return 'card';
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw && isViewMode(raw)) return raw;
	} catch {
		// ignore
	}
	return 'card';
}

export function saveViewMode(mode: ViewMode): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// ignore
	}
}

export function cycleViewMode(current: ViewMode): ViewMode {
	const index = CYCLE_ORDER.indexOf(current);
	return CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}
