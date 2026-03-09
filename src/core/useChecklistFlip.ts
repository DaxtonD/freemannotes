import { useLayoutEffect, useRef, useCallback } from 'react';

/**
 * FLIP animation hook for checklist indent / un-indent operations.
 *
 * FLIP = First, Last, Invert, Play
 *   1. **First** – snapshot every item's bounding rect *before* the state
 *      change that reorders the list.
 *   2. **Last** – after React re-renders, read the new bounding rects.
 *   3. **Invert** – apply a CSS transform so each item appears at its old
 *      position.
 *   4. **Play** – remove the transform with a CSS transition, producing a
 *      smooth animation from old → new position.
 *
 * Usage:
 * ```ts
 * const { capturePositions } = useChecklistFlip(rowContainersRef, items);
 *
 * // Before setItems / replaceChecklistItems:
 * capturePositions();
 * setItems(next);
 * ```
 */
export function useChecklistFlip(
	/** Map from item id → <li> DOM element. */
	rowContainersRef: React.RefObject<Map<string, HTMLLIElement | null>>,
	/** The current items array — only its identity (reference) matters so
	 *  the layout effect re-runs after every reorder. */
	items: unknown,
): { capturePositions: () => void } {
	const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

	const capturePositions = useCallback((): void => {
		const rects = new Map<string, DOMRect>();
		const map = rowContainersRef.current;
		if (!map) return;
		for (const [id, el] of map.entries()) {
			if (el) rects.set(id, el.getBoundingClientRect());
		}
		prevRectsRef.current = rects;
	}, [rowContainersRef]);

	useLayoutEffect(() => {
		const prevRects = prevRectsRef.current;

		// Nothing to animate — no snapshot was taken.
		if (prevRects.size === 0) return;

		// Consume the snapshot so we only animate once per capture.
		prevRectsRef.current = new Map();

		const map = rowContainersRef.current;
		if (!map) return;

		const durationMs = 250;
		const easing = 'cubic-bezier(0.25, 0.1, 0.25, 1)';
		const animatedEls: HTMLLIElement[] = [];

		for (const [id, el] of map.entries()) {
			if (!el) continue;
			const prev = prevRects.get(id);
			// Missing-snapshot branch:
			// If an element did not exist in the pre-mutation snapshot (newly mounted or
			// virtualized), we skip FLIP for that row to avoid inventing bogus deltas.
			if (!prev) continue;

			const curr = el.getBoundingClientRect();
			const dx = prev.left - curr.left;
			const dy = prev.top - curr.top;

			// Skip items that didn't move (or moved < 1px).
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;

			// INVERT – place item at its old position (no transition).
			el.style.transition = 'none';
			el.style.transform = `translate(${dx}px, ${dy}px)`;

			// Force reflow so the browser registers the starting transform.
			// Using void to silence linters that flag unused expressions.
			void el.offsetHeight;

			// PLAY – animate to the final (natural) position.
			el.style.transition = `transform ${durationMs}ms ${easing}`;
			el.style.transform = '';
			animatedEls.push(el);
		}

		// No-movement branch:
		// If no row crossed the 1px threshold, skip timer/setup entirely.
		if (animatedEls.length === 0) return;

		const cleanup = (): void => {
			for (const el of animatedEls) {
				el.style.transition = '';
				el.style.transform = '';
			}
		};

		// Cleanup strategy branch:
		// We intentionally avoid one `transitionend` listener per row. Under large
		// reorder sets that creates many post-drop callbacks on the main thread.
		// A single batched timer keeps cleanup deterministic and cheaper.
		const timer = window.setTimeout(cleanup, durationMs + 50);

		// If the component unmounts mid-animation, tidy up.
		return () => {
			// Unmount/interruption branch:
			// Cancel pending timer and eagerly clear inline styles to prevent stale
			// transforms if the component rerenders/unmounts mid-animation.
			window.clearTimeout(timer);
			cleanup();
		};
		// We deliberately fire on every `items` identity change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items, rowContainersRef]);

	return { capturePositions };
}
