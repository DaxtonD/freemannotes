import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';
const SCROLL_LOCK_ALLOW_TOUCH_CLASS = 'body-scroll-lock-allow-touch';

let activeLockCount = 0;
let previousBodyTouchAction = '';
let previousHtmlTouchAction = '';
let previousHtmlOverflow = '';
let previousBodyOverflow = '';
let lockedScrollX = 0;
let lockedScrollY = 0;

export function useBodyScrollLock(locked: boolean, options?: { disableTouchAction?: boolean }): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const disableTouchAction = options?.disableTouchAction !== false;
		// Behaviour differs by input modality:
		//
		// Desktop (pointer:fine): apply overflow:hidden on html/body in JS to prevent
		// keyboard/wheel scroll of the background. Chrome desktop preserves window.scrollY
		// (the internal scrollTop is kept even when overflow:hidden) so the visual does NOT
		// snap to y=0 — the backdrop-filter:blur() shows the correct grid position.
		// Save + restore scrollX/Y as a safety net for unlock.
		//
		// Mobile (pointer:coarse): do NOT apply overflow:hidden — Chrome Android resets the
		// visual scroll to y=0 when overflow:hidden is applied to the scroll root, making the
		// backdrop-filter show the wrong part of the grid and breaking position:sticky on
		// .app-main-sticky. touch-action:none + overscroll-behavior:none (CSS class) is
		// sufficient to prevent touch scroll without affecting the visual position.
		const isDesktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

		if (activeLockCount === 0) {
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlTouchAction = html.style.touchAction;

			if (isDesktop) {
				lockedScrollX = window.scrollX ?? 0;
				lockedScrollY = window.scrollY ?? 0;
				previousHtmlOverflow = html.style.overflow;
				previousBodyOverflow = body.style.overflow;
				html.style.overflow = 'hidden';
				body.style.overflow = 'hidden';
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
				html.style.overflow = previousHtmlOverflow;
				body.style.overflow = previousBodyOverflow;
				// Restore scroll position after removing overflow:hidden so the page
				// returns to exactly where it was before the modal opened.
				window.scrollTo({ left: lockedScrollX, top: lockedScrollY, behavior: 'instant' as ScrollBehavior });
			}
		};
	}, [locked, options?.disableTouchAction]);
}
