import React from 'react';

const SCROLL_LOCK_CLASS = 'body-scroll-locked';
const SCROLL_LOCK_ALLOW_TOUCH_CLASS = 'body-scroll-lock-allow-touch';

let activeLockCount = 0;
let previousBodyOverflow = '';
let previousBodyOverscroll = '';
let previousBodyTouchAction = '';
let previousHtmlOverflow = '';
let previousHtmlOverscroll = '';
let previousHtmlTouchAction = '';
let lockedScrollX = 0;
let lockedScrollY = 0;

function readWindowScrollPosition(): { x: number; y: number } {
	// Some overlay flows lock the root while the real scroll offset still lives on
	// `document.scrollingElement`, so capture both sources before freezing layout.
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return { x: 0, y: 0 };
	}
	const scrollingElement = document.scrollingElement;
	return {
		x: window.scrollX || scrollingElement?.scrollLeft || 0,
		y: window.scrollY || scrollingElement?.scrollTop || 0,
	};
}

function restoreWindowScrollPosition(scrollX: number, scrollY: number): void {
	// Write through both APIs because browsers disagree about which one wins during
	// the same frame that `overflow: hidden` is toggled on the root elements.
	if (typeof window === 'undefined' || typeof document === 'undefined') return;
	const scrollingElement = document.scrollingElement;
	if (scrollingElement) {
		scrollingElement.scrollLeft = scrollX;
		scrollingElement.scrollTop = scrollY;
	}
	window.scrollTo({ left: scrollX, top: scrollY, behavior: 'auto' });
}

export function useBodyScrollLock(locked: boolean, options?: { disableTouchAction?: boolean }): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const html = document.documentElement;
		const body = document.body;
		const disableTouchAction = options?.disableTouchAction !== false;
		if (activeLockCount === 0) {
			// Capture and restore both html/body styles because this app uses nested scroll
			// containers and mobile browsers happily keep scrolling whichever root still can.
			const nextScroll = readWindowScrollPosition();
			lockedScrollX = nextScroll.x;
			lockedScrollY = nextScroll.y;
			previousBodyOverflow = body.style.overflow;
			previousBodyOverscroll = (body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior || '';
			previousBodyTouchAction = body.style.touchAction;
			previousHtmlOverflow = html.style.overflow;
			previousHtmlOverscroll = (html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior || '';
			previousHtmlTouchAction = html.style.touchAction;

			html.classList.add(SCROLL_LOCK_CLASS);
			body.classList.add(SCROLL_LOCK_CLASS);
			if (!disableTouchAction) {
				html.classList.add(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
				body.classList.add(SCROLL_LOCK_ALLOW_TOUCH_CLASS);
			}
			html.style.overflow = 'hidden';
			body.style.overflow = 'hidden';
			(html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
			(body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
			if (disableTouchAction) {
				html.style.touchAction = 'none';
				body.style.touchAction = 'none';
			}
			if (typeof window !== 'undefined') {
				// Restore immediately and again on the next frame so modal open/close does
				// not snap nested note-grid layouts back to the top.
				restoreWindowScrollPosition(lockedScrollX, lockedScrollY);
				window.requestAnimationFrame(() => {
					restoreWindowScrollPosition(lockedScrollX, lockedScrollY);
				});
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
			html.style.overflow = previousHtmlOverflow;
			body.style.overflow = previousBodyOverflow;
			(html.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = previousHtmlOverscroll;
			(body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = previousBodyOverscroll;
			html.style.touchAction = previousHtmlTouchAction;
			body.style.touchAction = previousBodyTouchAction;
			if (typeof window !== 'undefined') {
				// Mirror the lock-path restore so unlock cannot reveal a stale root scroll
				// position after layout reflows.
				restoreWindowScrollPosition(lockedScrollX, lockedScrollY);
				window.requestAnimationFrame(() => {
					restoreWindowScrollPosition(lockedScrollX, lockedScrollY);
				});
			}
		};
	}, [locked, options?.disableTouchAction]);
}