const STORAGE_KEY = 'fn_bubble_zoom_v1';
export const BUBBLE_ZOOM_MIN = 50;
export const BUBBLE_ZOOM_MAX = 150;
const DEFAULT_BUBBLE_ZOOM = BUBBLE_ZOOM_MIN;

function clampBubbleZoom(value: number): number {
	return Math.max(BUBBLE_ZOOM_MIN, Math.min(BUBBLE_ZOOM_MAX, Math.round(value)));
}

export function loadBubbleZoom(): number {
	if (typeof window === 'undefined') return DEFAULT_BUBBLE_ZOOM;
	try {
		const raw = Number(window.localStorage.getItem(STORAGE_KEY));
		if (Number.isFinite(raw)) return clampBubbleZoom(raw);
	} catch {
		// ignore
	}
	return DEFAULT_BUBBLE_ZOOM;
}

export function saveBubbleZoom(value: number): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, String(clampBubbleZoom(value)));
	} catch {
		// ignore
	}
}