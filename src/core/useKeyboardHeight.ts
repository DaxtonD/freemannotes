import { useEffect, useRef, useState } from 'react';

/**
 * Minimum pixel difference between window.innerHeight and
 * visualViewport.height before we consider the software keyboard "open."
 */
const KEYBOARD_THRESHOLD = 100;

interface KeyboardState {
	isOpen: boolean;
	/**
	 * The absolute `top` position (in CSS px) where the bottom of the visible
	 * viewport sits — i.e. the visual viewport's offsetTop + its height.
	 * Position the floating toolbar so its bottom aligns with this value.
	 */
	visibleBottom: number;
}

const CLOSED: KeyboardState = { isOpen: false, visibleBottom: 0 };

/**
 * Detects whether the mobile software keyboard is open and returns the
 * bottom edge of the visible viewport so a toolbar can be positioned
 * directly above the keyboard.
 *
 * Uses the Visual Viewport API; on browsers/devices that lack it,
 * permanently returns the "closed" state.
 *
 * Updates only on `visualViewport` resize/scroll events – no polling,
 * no RAF loops, and no state changes when the keyboard is not moving.
 */
export function useKeyboardHeight(): KeyboardState {
	const [state, setState] = useState<KeyboardState>(CLOSED);
	const prevRef = useRef(CLOSED);

	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		const update = (): void => {
			const kbHeight = Math.round(window.innerHeight - vv.height);
			const isOpen = kbHeight > KEYBOARD_THRESHOLD;
			const visibleBottom = Math.round(vv.offsetTop + vv.height);
			const next: KeyboardState = isOpen
				? { isOpen: true, visibleBottom }
				: CLOSED;

			// Skip setState when nothing changed to avoid unnecessary renders.
			if (next.isOpen === prevRef.current.isOpen && next.visibleBottom === prevRef.current.visibleBottom) return;
			prevRef.current = next;
			setState(next);
		};

		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		update();

		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		};
	}, []);

	return state;
}
