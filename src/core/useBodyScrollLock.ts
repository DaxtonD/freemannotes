import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';
const SCROLL_LOCK_ALLOW_TOUCH_CLASS = 'body-scroll-lock-allow-touch';

let activeLockCount = 0;
let previousBodyTouchAction = '';
let previousHtmlTouchAction = '';

export function useBodyScrollLock(locked: boolean, options?: { disableTouchAction?: boolean }): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const disableTouchAction = options?.disableTouchAction !== false;
		if (activeLockCount === 0) {
			// On mobile (pointer: coarse), we rely on touch-action:none + overscroll-behavior:none
			// (applied via CSS class below) instead of overflow:hidden on html/body.
			// Setting overflow:hidden on the scroll root resets the visual scroll position
			// to y=0 on Android Chrome — the page content appears at the top behind any
			// backdrop-filter:blur() overlay, showing the wrong part of the grid.
			// On desktop (pointer: fine), overflow:hidden is applied via CSS (see globals.css
			// @media (pointer:fine) rule) to prevent keyboard/wheel scroll of the background.
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlTouchAction = html.style.touchAction;

			html.classList.add(SCROLL_LOCK_CLASS);
			body.classList.add(SCROLL_LOCK_CLASS);
			if (!disableTouchAction) {
				html.classList.add(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
				body.classList.add(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
			}
			if (disableTouchAction) {
				html.style.touchAction = 'none';
				body.style.touchAction = 'none';
			}
		}
		activeLockCount += 1;
		return () => {
			activeLockCount = Math.max(0, activeLockCount - 1);
			if (activeLockCount > 0) return;
			html.classList.remove(SCROLL_LOCK_CLASS);
			body.classList.remove(SCROLL_LOCK_CLASS);
			html.classList.remove(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
			body.classList.remove(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
			html.style.touchAction = previousHtmlTouchAction;
			body.style.touchAction = previousBodyTouchAction;
		};
	}, [locked, options?.disableTouchAction]);
}
