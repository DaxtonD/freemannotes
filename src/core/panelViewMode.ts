import React from 'react';

export type PanelViewMode = 'card' | 'list';

// Card or list view for the attachment panels. A per-device display preference, not note
// data, so it lives in localStorage and never syncs through Yjs. Links keeps the key it
// originally shipped with, so anyone who already switched links to list view keeps it.
export const PANEL_VIEW_MODE_STORAGE_KEYS = {
	links: 'freemannotes.noteLinkPanelViewMode',
	images: 'freemannotes.noteImagePanelViewMode',
	drawings: 'freemannotes.noteDrawingPanelViewMode',
	documents: 'freemannotes.noteDocumentPanelViewMode',
} as const;

const PANEL_VIEW_MODE_CHANGED_EVENT = 'freemannotes:panel-view-mode-changed';

function readStoredPanelViewMode(storageKey: string, fallback: PanelViewMode): PanelViewMode {
	if (typeof window === 'undefined') return fallback;
	try {
		const stored = window.localStorage.getItem(storageKey);
		return stored === 'card' || stored === 'list' ? stored : fallback;
	} catch {
		return fallback;
	}
}

export function usePanelViewMode(storageKey: string, defaultMode: PanelViewMode): readonly [PanelViewMode, () => void] {
	const [mode, setMode] = React.useState<PanelViewMode>(() => readStoredPanelViewMode(storageKey, defaultMode));
	const modeRef = React.useRef(mode);
	modeRef.current = mode;

	React.useEffect(() => {
		// The same kind of panel can be on screen twice (an editor's attachment sheet and a
		// note card's attachment browser). Flipping one flips the other.
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ storageKey?: string; mode?: PanelViewMode }>).detail;
			if (detail?.storageKey !== storageKey) return;
			if (detail.mode === 'card' || detail.mode === 'list') setMode(detail.mode);
		};
		window.addEventListener(PANEL_VIEW_MODE_CHANGED_EVENT, onChanged as EventListener);
		return () => window.removeEventListener(PANEL_VIEW_MODE_CHANGED_EVENT, onChanged as EventListener);
	}, [storageKey]);

	const toggle = React.useCallback((): void => {
		const next: PanelViewMode = modeRef.current === 'card' ? 'list' : 'card';
		setMode(next);
		try {
			window.localStorage.setItem(storageKey, next);
		} catch {
			// Best effort only — worst case the preference doesn't persist.
		}
		window.dispatchEvent(new CustomEvent(PANEL_VIEW_MODE_CHANGED_EVENT, { detail: { storageKey, mode: next } }));
	}, [storageKey]);

	return [mode, toggle] as const;
}
