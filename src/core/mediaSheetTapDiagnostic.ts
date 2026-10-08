import { debugLog, isDebugLogEnabled } from './debugLog';

/**
 * Records what actually happens to a tap inside the open media sheet.
 *
 * SOLVED 2026-10-08, kept as a regression detector. This bug has recurred for a long time, because
 * every control added to the sheet inherits it, and reading the source produced five confident
 * wrong answers in a row (a markup: room prefix, schema drift, a stale-workspace scan, the open
 * animation moving the target, and content loading). One capture settled it in a minute.
 *
 * What it found: touchstart and touchend both land on the correct element, unmoved, with the sheet
 * settled and `defaultPrevented: false` in the bubble phase — and then no click is ever dispatched.
 * Nothing in this codebase suppresses it. The browser withholds the synthetic click because the tap
 * landed in a horizontally scrollable region (the capture shows 13 scroll events on the tab strip
 * during one failing tap) and it may still need to treat that touch as the start of a scroll.
 *
 * If a control in the sheet ever goes back to needing two taps, turn the debug toggle on and
 * reproduce rather than reasoning about it. The entry you want is `media-tap-noclick`.
 *
 * Everything is attached in the CAPTURE phase on `document`. That matters: the sheet's own drag
 * handlers call stopPropagation(), so a listener anywhere below document would be told a different
 * story than the browser is actually acting on.
 *
 * What the three outcomes mean, so the log can be read without re-deriving this:
 *
 *   `media-tap-click` with `sameAsStart: true`
 *       The browser did deliver a click to the element that was touched. If the control still did
 *       nothing, the fault is above us — a React handler that didn't run, or a node that was
 *       replaced between touchend and click (look at `reactRemount`).
 *
 *   `media-tap-click` with `sameAsStart: false`
 *       The click landed somewhere else. The element under the finger changed between touchdown
 *       and liftoff — the sheet was still moving. `transformAtEnd` will differ from
 *       `transformAtStart` and `settled` will be false.
 *
 *   `media-tap-noclick`
 *       No click was synthesized at all within 500ms. Something called preventDefault() on the
 *       touch sequence, or the touch was treated as a gesture rather than a tap.
 */

type TapRecord = {
	startedAt: number;
	x: number;
	y: number;
	startDescription: string;
	startTransform: string;
	noClickTimer: number;
};

let activeTap: TapRecord | null = null;

/** Enough to identify a control in a log line without dumping the DOM. */
function describe(node: EventTarget | Element | null): string {
	if (!(node instanceof Element)) return '<none>';
	const tag = node.tagName.toLowerCase();
	const cls = (node.className && typeof node.className === 'string')
		? '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.')
		: '';
	const label = node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 24) ?? '';
	const button = node.closest('button');
	const inButton = button ? ` inBtn[${button.getAttribute('aria-label') ?? button.textContent?.trim().slice(0, 20) ?? '?'}]` : ' inBtn[none]';
	return `${tag}${cls}${label ? ` "${label}"` : ''}${inButton}`;
}

/** The sheet's live transform tells us whether the open animation is still running. */
function readSheetTransform(sheet: HTMLElement | null): string {
	if (!sheet) return '<no sheet>';
	try {
		const value = getComputedStyle(sheet).transform;
		return value === 'none' ? 'none' : value.replace(/matrix\(1, 0, 0, 1, /, 'xy(').replace(/\)$/, ')');
	} catch {
		return '<unreadable>';
	}
}

/**
 * @param getSheet   the sheet element, so its transform can be sampled at touchdown and liftoff
 * @param getContext extra state to stamp on every entry (progress, open, dragging, tab)
 * @returns cleanup
 */
export function installMediaSheetTapDiagnostic(
	getSheet: () => HTMLElement | null,
	getContext: () => Record<string, unknown>,
): () => void {
	if (typeof document === 'undefined' || !isDebugLogEnabled()) return () => {};

	const onTouchStart = (event: TouchEvent): void => {
		const touch = event.touches[0];
		if (!touch) return;
		const sheet = getSheet();
		// Only taps that begin inside the sheet are interesting.
		if (!sheet || !(event.target instanceof Node) || !sheet.contains(event.target)) return;
		if (activeTap) window.clearTimeout(activeTap.noClickTimer);
		activeTap = {
			startedAt: performance.now(),
			x: touch.clientX,
			y: touch.clientY,
			startDescription: describe(event.target),
			startTransform: readSheetTransform(sheet),
			noClickTimer: 0,
		};
		debugLog('media-tap-start', { target: activeTap.startDescription, x: Math.round(touch.clientX), y: Math.round(touch.clientY), transform: activeTap.startTransform, ...getContext() });
	};

	const onTouchEnd = (event: TouchEvent): void => {
		const tap = activeTap;
		if (!tap) return;
		const touch = event.changedTouches[0];
		const x = touch?.clientX ?? tap.x;
		const y = touch?.clientY ?? tap.y;
		const endTransform = readSheetTransform(getSheet());
		// The decisive measurement: what is under the finger NOW, versus what was under it at
		// touchdown. If these differ, the sheet moved and the click cannot land where aimed.
		const under = document.elementFromPoint(x, y);
		debugLog('media-tap-end', {
			startTarget: tap.startDescription,
			nowUnderFinger: describe(under),
			moved: `${Math.round(x - tap.x)},${Math.round(y - tap.y)}`,
			heldMs: Math.round(performance.now() - tap.startedAt),
			transformAtStart: tap.startTransform,
			transformAtEnd: endTransform,
			settled: tap.startTransform === endTransform,
			...getContext(),
		});
		tap.noClickTimer = window.setTimeout(() => {
			debugLog('media-tap-noclick', {
				startTarget: tap.startDescription,
				note: 'no click within 500ms of touchend — something preventDefaulted the sequence or it was taken as a gesture',
				...getContext(),
			});
			activeTap = null;
		}, 500);
	};

	const onTouchCancel = (): void => {
		const tap = activeTap;
		if (!tap) return;
		window.clearTimeout(tap.noClickTimer);
		activeTap = null;
		debugLog('media-tap-CANCELLED', {
			startTarget: tap.startDescription,
			note: 'browser cancelled the touch — the compositor took the gesture, so no click is coming',
			...getContext(),
		});
	};

	const onScroll = (event: Event): void => {
		// Only while a tap is in flight, and only for scrollers inside the sheet. A scroll firing
		// here means the tap was consumed to stop momentum rather than delivered as a click.
		if (!activeTap || !(event.target instanceof Element)) return;
		debugLog('media-tap-scroll-during', {
			scroller: describe(event.target),
			scrollTop: Math.round((event.target as HTMLElement).scrollTop ?? 0),
			...getContext(),
		});
	};

	const onClick = (event: MouseEvent): void => {
		const tap = activeTap;
		if (!tap) return;
		window.clearTimeout(tap.noClickTimer);
		activeTap = null;
		debugLog('media-tap-click', {
			startTarget: tap.startDescription,
			clickTarget: describe(event.target),
			sameAsStart: describe(event.target) === tap.startDescription,
			sinceTouchStartMs: Math.round(performance.now() - tap.startedAt),
			...getContext(),
		});
	};

	// Bubble phase, so it runs AFTER every handler that might have called preventDefault —
	// including React's, which attaches at the root container. The capture listener above cannot
	// see this: it runs first, before anyone has had the chance. `defaultPrevented` here is the
	// difference between "the browser refused to make a click" and "our own code suppressed it",
	// and those have opposite fixes.
	const onTouchEndBubble = (event: TouchEvent): void => {
		const sheet = getSheet();
		if (!sheet || !(event.target instanceof Node) || !sheet.contains(event.target)) return;
		debugLog('media-tap-end-bubble', {
			defaultPrevented: event.defaultPrevented,
			cancelable: event.cancelable,
			target: describe(event.target),
			...getContext(),
		});
	};

	document.addEventListener('touchend', onTouchEndBubble, false);
	document.addEventListener('touchstart', onTouchStart, true);
	document.addEventListener('touchend', onTouchEnd, true);
	document.addEventListener('touchcancel', onTouchCancel, true);
	document.addEventListener('scroll', onScroll, true);
	document.addEventListener('click', onClick, true);
	return () => {
		if (activeTap) window.clearTimeout(activeTap.noClickTimer);
		activeTap = null;
		document.removeEventListener('touchend', onTouchEndBubble, false);
		document.removeEventListener('touchstart', onTouchStart, true);
		document.removeEventListener('touchend', onTouchEnd, true);
		document.removeEventListener('touchcancel', onTouchCancel, true);
		document.removeEventListener('scroll', onScroll, true);
		document.removeEventListener('click', onClick, true);
	};
}
