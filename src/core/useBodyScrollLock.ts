import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';

let activeLockCount = 0;
let previousBodyOverflow = '';
let previousBodyOverscroll = '';
let previousBodyTouchAction = '';
let previousHtmlOverflow = '';
let previousHtmlOverscroll = '';
let previousHtmlTouchAction = '';

export function useBodyScrollLock(locked: boolean): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		if (activeLockCount === 0) {
			// Capture and restore both html/body styles because this app uses nested scroll
			// containers and mobile browsers happily keep scrolling whichever root still can.
			previousBodyOverflow = body.style.overflow;
			previousBodyOverscroll = (body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior || '';
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlOverflow = html.style.overflow;
			previousHtmlOverscroll = (html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior || '';
			previousHtmlTouchAction = html.style.touchAction;

			html.classList.add(SCROLL_LOCK_CLASS);
			body.classList.add(SCROLL_LOCK_CLASS);
			html.style.overflow = 'hidden';
			body.style.overflow = 'hidden';
			(html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
			(body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
			html.style.touchAction = 'none';
			body.style.touchAction = 'none';
		}
		activeLockCount += 1;
		return () => {
			activeLockCount = Math.max(0, activeLockCount - 1);
			if (activeLockCount > 0) return;
			html.classList.remove(SCROLL_LOCK_CLASS);
			body.classList.remove(SCROLL_LOCK_CLASS);
			html.style.overflow = previousHtmlOverflow;
			body.style.overflow = previousBodyOverflow;
			(html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = previousHtmlOverscroll;
			(body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = previousBodyOverscroll;
			html.style.touchAction = previousHtmlTouchAction;
			body.style.touchAction = previousBodyTouchAction;
		};
	}, [locked]);
}