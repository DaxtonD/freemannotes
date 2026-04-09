type PointerInput = {
	clientX: number;
	clientY: number;
};

type ScrollContainer = Window | HTMLElement;

type AutoScrollerOptions = {
	getPointerInput: () => PointerInput | null;
	getScrollContainer: () => ScrollContainer;
	edgePx?: number;
	minSpeedPxPerSecond?: number;
	maxSpeedPxPerSecond?: number;
	onDidScroll?: () => void;
};

type EdgeScrollDeltaOptions = {
	pointerY: number;
	top: number;
	bottom: number;
	canScrollUp: boolean;
	canScrollDown: boolean;
	edgePx: number;
	minSpeedPxPerSecond: number;
	maxSpeedPxPerSecond: number;
	dtMs: number;
};

function isScrollableElement(element: HTMLElement): boolean {
	const style = window.getComputedStyle(element);
	const overflowY = style.overflowY;
	return /(auto|scroll|overlay)/.test(overflowY) && element.scrollHeight > element.clientHeight + 1;
}

export function getClosestVerticalScrollContainer(start: HTMLElement | null): ScrollContainer {
	let current = start?.parentElement ?? null;
	while (current) {
		if (isScrollableElement(current)) return current;
		current = current.parentElement;
	}
	return window;
}

export function getEdgeScrollDelta(options: EdgeScrollDeltaOptions): number {
	const {
		pointerY,
		top,
		bottom,
		canScrollUp,
		canScrollDown,
		edgePx,
		minSpeedPxPerSecond,
		maxSpeedPxPerSecond,
		dtMs,
	} = options;
	const distanceToTop = pointerY - top;
	const distanceToBottom = bottom - pointerY;
	const dtSeconds = Math.max(0, dtMs) / 1000;

	const resolveDelta = (ratio: number, direction: -1 | 1): number => {
		const easedRatio = ratio * ratio;
		const speed = minSpeedPxPerSecond + easedRatio * (maxSpeedPxPerSecond - minSpeedPxPerSecond);
		return direction * speed * dtSeconds;
	};

	if (distanceToTop < edgePx && canScrollUp) {
		const ratio = Math.max(0, Math.min(1, (edgePx - distanceToTop) / edgePx));
		return resolveDelta(ratio, -1);
	}
	if (distanceToBottom < edgePx && canScrollDown) {
		const ratio = Math.max(0, Math.min(1, (edgePx - distanceToBottom) / edgePx));
		return resolveDelta(ratio, 1);
	}
	return 0;
}

export function createPointerEdgeAutoScroller(options: AutoScrollerOptions): {
	start: () => void;
	stop: () => void;
} {
	const edgePx = options.edgePx ?? 60;
	const minSpeedPxPerSecond = options.minSpeedPxPerSecond ?? 90;
	const maxSpeedPxPerSecond = options.maxSpeedPxPerSecond ?? 1500;
	let rafId = 0;
	let running = false;
	let lastTickAt = 0;

	const tick = (now: number): void => {
		if (!running) return;
		rafId = window.requestAnimationFrame(tick);
		const pointer = options.getPointerInput();
		if (!pointer) return;
		const dtMs = lastTickAt > 0 ? Math.min(34, now - lastTickAt) : 16;
		lastTickAt = now;

		const container = options.getScrollContainer();
		let top = 0;
		let bottom = window.innerHeight;
		let canScrollUp = false;
		let canScrollDown = false;
		let scrollBy = (deltaY: number): void => {
			window.scrollBy(0, deltaY);
		};

		if (container instanceof HTMLElement) {
			const rect = container.getBoundingClientRect();
			top = rect.top;
			bottom = rect.bottom;
			canScrollUp = container.scrollTop > 0;
			canScrollDown = container.scrollTop + container.clientHeight < container.scrollHeight - 1;
			scrollBy = (deltaY: number): void => {
				container.scrollTop += deltaY;
			};
		} else {
			const doc = document.documentElement;
			top = 0;
			bottom = window.innerHeight;
			canScrollUp = window.scrollY > 0;
			canScrollDown = window.scrollY + window.innerHeight < doc.scrollHeight - 1;
		}

		const deltaY = getEdgeScrollDelta({
			pointerY: pointer.clientY,
			top,
			bottom,
			canScrollUp,
			canScrollDown,
			edgePx,
			minSpeedPxPerSecond,
			maxSpeedPxPerSecond,
			dtMs,
		});
		if (deltaY === 0) return;
		scrollBy(deltaY);
		options.onDidScroll?.();
	};

	return {
		start(): void {
			if (running) return;
			running = true;
			lastTickAt = 0;
			rafId = window.requestAnimationFrame(tick);
		},
		stop(): void {
			running = false;
			lastTickAt = 0;
			if (rafId) {
				window.cancelAnimationFrame(rafId);
				rafId = 0;
			}
		},
	};
}
