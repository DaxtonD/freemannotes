/**
 * Touch-to-drag polyfill for @atlaskit/pragmatic-drag-and-drop on Firefox Android.
 *
 * Chrome Android synthesizes HTML5 DnD events (dragstart, drag, drop, dragend)
 * from touch long-press on draggable elements. Firefox Android does not.
 * This polyfill bridges the gap by detecting long-press on drag handles and
 * dispatching synthetic DragEvents that pragmatic-drag-and-drop processes normally.
 *
 * Key compatibility detail: pragmatic-drag-and-drop's broken-drag detector
 * listens for `pointermove` events on window — during a real browser drag the
 * browser suppresses pointer events, so any pointermove means the drag was
 * lost.  In our synthetic drag, the browser still fires pointermove from touch
 * input, so we must suppress them during the polyfill drag to prevent the
 * library from cancelling our synthetic drag after ~20 moves.
 *
 * Requires `touch-action: none` on the drag handle element so the browser does
 * not claim the touch for scroll/pan, allowing the polyfill to receive the full
 * touch event stream.
 */

const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD_SQ = 10 * 10; // 10 px, squared for cheap distance check
const EDGE_SCROLL_THRESHOLD_PX = 72;
const MAX_EDGE_SCROLL_STEP_PX = 18;

let syntheticTouchDragActive = false;

function needsPolyfill(): boolean {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
	const ua = navigator.userAgent;
	// Firefox on Android: contains "Android" and "Firefox" but not "Chrome".
	return /Android/i.test(ua) && /Firefox/i.test(ua) && !/Chrome/i.test(ua);
}

export function isTouchDragPolyfillActive(): boolean {
	return syntheticTouchDragActive;
}

export function installTouchDragPolyfill(): void {
	if (!needsPolyfill()) return;

	let dragSource: HTMLElement | null = null;
	let dataTransfer: DataTransfer | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let isDragging = false;
	let startX = 0;
	let startY = 0;
	let lastClientX = 0;
	let lastClientY = 0;
	let lastScreenX = 0;
	let lastScreenY = 0;
	let edgeScrollRaf = 0;

	function scheduleEdgeScroll(): void {
		if (edgeScrollRaf || !isDragging) return;
		edgeScrollRaf = window.requestAnimationFrame(() => {
			edgeScrollRaf = 0;
			if (!isDragging) return;
			const viewportHeight = window.innerHeight;
			if (viewportHeight <= 0) return;
			let scrollStep = 0;
			if (lastClientY < EDGE_SCROLL_THRESHOLD_PX) {
				const proximity = EDGE_SCROLL_THRESHOLD_PX - lastClientY;
				scrollStep = -Math.min(MAX_EDGE_SCROLL_STEP_PX, Math.max(4, proximity * 0.22));
			} else if (lastClientY > viewportHeight - EDGE_SCROLL_THRESHOLD_PX) {
				const proximity = lastClientY - (viewportHeight - EDGE_SCROLL_THRESHOLD_PX);
				scrollStep = Math.min(MAX_EDGE_SCROLL_STEP_PX, Math.max(4, proximity * 0.22));
			}
			if (scrollStep !== 0) {
				const maxScrollY = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
				const nextScrollY = Math.max(0, Math.min(maxScrollY, window.scrollY + scrollStep));
				if (nextScrollY !== window.scrollY) {
					window.scrollTo({ top: nextScrollY, behavior: 'auto' });
					const el = document.elementFromPoint(lastClientX, lastClientY) ?? document.documentElement;
					fire(el, 'dragover');
				}
			}
			if (isDragging) scheduleEdgeScroll();
		});
	}

	function fire(target: EventTarget, type: string): boolean {
		return target.dispatchEvent(
			new DragEvent(type, {
				bubbles: true,
				cancelable: true,
				clientX: lastClientX,
				clientY: lastClientY,
				screenX: lastScreenX,
				screenY: lastScreenY,
				dataTransfer: dataTransfer!,
			}),
		);
	}

	function reset(): void {
		if (timer != null) {
			clearTimeout(timer);
			timer = null;
		}
		if (edgeScrollRaf) {
			window.cancelAnimationFrame(edgeScrollRaf);
			edgeScrollRaf = 0;
		}
		dragSource = null;
		dataTransfer = null;
		isDragging = false;
		syntheticTouchDragActive = false;
	}

	// --- Suppress pointer events during the synthetic drag ---
	// pragmatic-drag-and-drop's broken-drag detector counts pointermove events
	// and cancels the drag after ~20. During a real browser drag, pointer events
	// are suppressed by the UA. We replicate that by stopping propagation of
	// pointermove/pointerdown while our synthetic drag is active.
	window.addEventListener(
		'pointermove',
		(e: PointerEvent) => {
			if (isDragging) e.stopImmediatePropagation();
		},
		{ capture: true },
	);
	window.addEventListener(
		'pointerdown',
		(e: PointerEvent) => {
			if (isDragging) e.stopImmediatePropagation();
		},
		{ capture: true },
	);
	window.addEventListener(
		'pointerup',
		(e: PointerEvent) => {
			if (isDragging) e.stopImmediatePropagation();
		},
		{ capture: true },
	);

	// --- Suppress the native context menu on drag handles ---
	// Firefox Android fires contextmenu on long-press (~500ms) which could
	// steal the touch event stream and interrupt our synthetic drag.
	document.addEventListener(
		'contextmenu',
		(e: MouseEvent) => {
			if (!isDragging && !dragSource) return;
			const target = e.target;
			if (target instanceof HTMLElement && target.closest('[data-drag-handle="true"]')) {
				e.preventDefault();
			}
		},
		{ capture: true },
	);

	// --- touchstart: begin long-press timer if touch is on a drag handle ---
	document.addEventListener(
		'touchstart',
		(e: TouchEvent) => {
			if (dragSource) return; // already tracking a gesture
			if (e.touches.length !== 1) return;
			const t = e.target;
			if (!(t instanceof HTMLElement)) return;
			if (!t.closest('[data-drag-handle="true"]')) return;
			const draggable = t.closest('[draggable="true"]');
			if (!(draggable instanceof HTMLElement)) return;

			const touch = e.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			lastClientX = touch.clientX;
			lastClientY = touch.clientY;
			lastScreenX = touch.screenX;
			lastScreenY = touch.screenY;
			dragSource = draggable;

			timer = setTimeout(() => {
				timer = null;
				if (!dragSource) return;
				try {
					dataTransfer = new DataTransfer();
				} catch {
					reset();
					return;
				}
				// Dispatch synthetic dragstart on the registered draggable element.
				// If pragmatic-drag-and-drop's canDrag() rejects, the event is cancelled.
				if (!fire(dragSource, 'dragstart')) {
					reset();
					return;
				}
				isDragging = true;
					syntheticTouchDragActive = true;
					scheduleEdgeScroll();
			}, LONG_PRESS_MS);
		},
		{ passive: true, capture: true },
	);

	// --- touchmove: cancel long-press on movement, or relay as dragover ---
	document.addEventListener(
		'touchmove',
		(e: TouchEvent) => {
			const touch = e.touches[0];
			if (!touch) return;
			// Fast exit for touches unrelated to a drag-handle gesture.
			if (!dragSource && !isDragging) return;

			lastClientX = touch.clientX;
			lastClientY = touch.clientY;
			lastScreenX = touch.screenX;
			lastScreenY = touch.screenY;

			if (isDragging) {
				// Prevent scroll as a safety net (primary prevention is touch-action:none CSS).
				if (e.cancelable) e.preventDefault();
				// Dispatch dragover on the element under the finger for drop-target detection.
				const el = document.elementFromPoint(touch.clientX, touch.clientY) ?? document.documentElement;
				fire(el, 'dragover');
				scheduleEdgeScroll();
				return;
			}

			// Still waiting for long-press — cancel if finger moved too far.
			if (timer != null) {
				const dx = touch.clientX - startX;
				const dy = touch.clientY - startY;
				if (dx * dx + dy * dy > MOVE_THRESHOLD_SQ) {
					reset();
				}
			}
		},
		{ passive: false, capture: true },
	);

	// --- touchend / touchcancel: finalize or cancel the drag ---
	function onTouchEnd(): void {
		if (isDragging && dataTransfer) {
			const el = document.elementFromPoint(lastClientX, lastClientY) ?? document.documentElement;
			fire(el, 'drop');
			fire(dragSource ?? document.documentElement, 'dragend');
		}
		reset();
	}

	document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
	document.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });
}
