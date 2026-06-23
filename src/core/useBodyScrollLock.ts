import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';
const SCROLL_LOCK_ALLOW_TOUCH_CLASS = 'body-scroll-lock-allow-touch';

let activeLockCount = 0;
let previousBodyTouchAction = '';
let previousHtmlTouchAction = '';

// Desktop uses position:fixed on body to lock scroll without overflow:hidden.
// overflow:hidden on the scroll root resets window.scrollY to 0 in Chrome, making
// the backdrop-filter:blur() overlay show the wrong part of the grid.
let previousBodyPosition = '';
let previousBodyTop = '';
let previousBodyLeft = '';
let previousBodyWidth = '';
let lockedScrollX = 0;
let lockedScrollY = 0;

export function useBodyScrollLock(locked: boolean, options?: { disableTouchAction?: boolean }): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const disableTouchAction = options?.disableTouchAction !== false;
		// pointer:fine = desktop — we use position:fixed on body to freeze scroll
		// without overflow:hidden (which visually snaps the page to y=0).
		// pointer:coarse = mobile — touch-action:none is sufficient; no position change needed.
		const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

		if (activeLockCount === 0) {
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlTouchAction = html.style.touchAction;

			if (isDesktop) {
				lockedScrollX = window.scrollX ?? 0;
				lockedScrollY = window.scrollY ?? 0;
				previousBodyPosition = body.style.position;
				previousBodyTop = body.style.top;
				previousBodyLeft = body.style.left;
				previousBodyWidth = body.style.width;
				body.style.position = 'fixed';
				body.style.top = `-${lockedScrollY}px`;
				body.style.left = lockedScrollX ? `-${lockedScrollX}px` : '0';
				body.style.width = '100%';
			}

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
			if (isDesktop) {
				body.style.position = previousBodyPosition;
				body.style.top = previousBodyTop;
				body.style.left = previousBodyLeft;
				body.style.width = previousBodyWidth;
				window.scrollTo({ left: lockedScrollX, top: lockedScrollY, behavior: 'instant' as ScrollBehavior });
			}
		};
	}, [locked, options?.disableTouchAction]);
}
