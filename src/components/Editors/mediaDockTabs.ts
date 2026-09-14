import React from 'react';

// The attachment sheet's tabs, in order: Images, Links, Drawings, Documents.
// The last-open tab is remembered per note by its number (sessionStorage), so new tabs
// only ever go on the end — slotting one into the middle would quietly send everyone's
// remembered tab to the wrong place.
export type MediaDockTab = 0 | 1 | 2 | 3;

export const MEDIA_DOCK_LAST_TAB: MediaDockTab = 3;

export function sanitizeMediaDockTab(value: unknown): MediaDockTab {
	const numeric = typeof value === 'string' ? Number(value) : value;
	return numeric === 1 || numeric === 2 || numeric === 3 ? numeric : 0;
}

// Every tab strip carries data-media-dock-tabs="true", so the auto-scroll below can find
// them without threading refs through three editors and their sheet + flyout copies.
const TAB_STRIP_SELECTOR = '[data-media-dock-tabs="true"]';

/** A touch that travelled further than this was scrolling the tab strip, not tapping a tab. */
const TAB_TAP_SLOP_PX = 10;

export function isMediaDockTabTap(
	start: { x: number; y: number } | null,
	touch: { clientX: number; clientY: number } | undefined
): boolean {
	if (!start || !touch) return true;
	return Math.abs(touch.clientX - start.x) <= TAB_TAP_SLOP_PX && Math.abs(touch.clientY - start.y) <= TAB_TAP_SLOP_PX;
}

function prefersReducedMotion(): boolean {
	try {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	} catch {
		return false;
	}
}

/** Slides the selected tab to the middle of any tab strip that's too narrow to show them all. */
export function scrollActiveMediaDockTabIntoView(): void {
	if (typeof document === 'undefined') return;
	document.querySelectorAll<HTMLElement>(TAB_STRIP_SELECTOR).forEach((strip) => {
		if (strip.scrollWidth <= strip.clientWidth + 1) return;
		const active = strip.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!active) return;
		const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
		strip.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
	});
}

/** Keeps the active tab in view whenever the tab changes (tap, panel swipe, restore) or the sheet opens. */
export function useMediaDockTabAutoScroll(tab: MediaDockTab, isOpen: boolean): void {
	React.useEffect(() => {
		if (typeof window === 'undefined') return;
		// Next frame: when the sheet has only just opened, its layout isn't settled yet.
		const frame = window.requestAnimationFrame(scrollActiveMediaDockTabIntoView);
		return () => window.cancelAnimationFrame(frame);
	}, [tab, isOpen]);
}
