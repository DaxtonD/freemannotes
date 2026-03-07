type PointerInput = {
	clientX: number;
	clientY: number;
};

type ScrollContainer = Window | HTMLElement;

type AutoScrollerOptions = {
	getPointerInput: () => PointerInput | null;
	getScrollContainer: () => ScrollContainer;
	edgePx?: number;
	maxStepPx?: number;
	onDidScroll?: () => void;
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

export function createPointerEdgeAutoScroller(options: AutoScrollerOptions): {
	start: () => void;
	stop: () => void;
} {
	const edgePx = options.edgePx ?? 60;
	const maxStepPx = options.maxStepPx ?? 18;
	let rafId = 0;
	let running = false;

	const tick = (): void => {
		if (!running) return;
		rafId = window.requestAnimationFrame(tick);
		const pointer = options.getPointerInput();
		if (!pointer) return;

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

		const distanceToTop = pointer.clientY - top;
		const distanceToBottom = bottom - pointer.clientY;
		let deltaY = 0;
		if (distanceToTop < edgePx && canScrollUp) {
			const ratio = Math.max(0, Math.min(1, (edgePx - distanceToTop) / edgePx));
			deltaY = -Math.ceil(2 + ratio * (maxStepPx - 2));
		} else if (distanceToBottom < edgePx && canScrollDown) {
			const ratio = Math.max(0, Math.min(1, (edgePx - distanceToBottom) / edgePx));
			deltaY = Math.ceil(2 + ratio * (maxStepPx - 2));
		}

		if (deltaY === 0) return;
		scrollBy(deltaY);
		options.onDidScroll?.();
	};

	return {
		start(): void {
			if (running) return;
			running = true;
			rafId = window.requestAnimationFrame(tick);
		},
		stop(): void {
			running = false;
			if (rafId) {
				window.cancelAnimationFrame(rafId);
				rafId = 0;
			}
		},
	};
}
