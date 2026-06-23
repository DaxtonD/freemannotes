import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';
const SCROLL_LOCK_ALLOW_TOUCH_CLASS = 'body-scroll-lock-allow-touch';

let activeLockCount = 0;
let previousBodyTouchAction = '';
let previousHtmlTouchAction = '';
// Desktop only: save/restore scroll position because overflow:hidden on the scroll
// root resets window.scrollY to 0 on desktop browsers (keyboard/wheel lock side-effect).
// On mobile (pointer:coarse) overflow:hidden is never applied so no save/restore needed.
let lockedScrollX = 0;
let lockedScrollY = 0;

export function useBodyScrollLock(locked: boolean, options?: { disableTouchAction?: boolean }): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const disableTouchAction = options?.disableTouchAction !== false;
		// pointer:fine = desktop — overflow:hidden IS applied by CSS, so we must save
		// and restore the scroll position around the lock.
		const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;
		if (activeLockCount === 0) {
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlTouchAction = html.style.touchAction;

			if (isDesktop) {
				lockedScrollX = window.scrollX ?? 0;
				lockedScrollY = window.scrollY ?? 0;
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
			// Restore scroll after removing the class so the now-unlocked document
			// returns to the same position it was at before the modal opened.
			if (isDesktop && typeof window !== 'undefined') {
				window.scrollTo({ left: lockedScrollX, top: lockedScrollY, behavior: 'instant' as ScrollBehavior });
			}
		};
	}, [locked, options?.disableTouchAction]);
}
