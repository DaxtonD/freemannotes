export type ViewportRectMap = Map<string, DOMRect>;
export type DocumentRect = {
	left: number;
	top: number;
	width: number;
	height: number;
	centerX: number;
	centerY: number;
};
export type DocumentRectMap = Map<string, DocumentRect>;

type RectSnapshot = {
	left: number;
	top: number;
};

const FLIP_ANIMATION_MS = 140;
const FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const flipCleanupTimers = new WeakMap<HTMLElement, number>();

function clearFlipStyles(container: HTMLElement): void {
	for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-note-id]'))) {
		const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
		content.style.transition = '';
		content.style.transform = '';
		content.style.willChange = '';
	}
}

function scheduleFlipCleanup(container: HTMLElement): void {
	if (typeof window === 'undefined') return;
	const previousTimer = flipCleanupTimers.get(container);
	if (previousTimer) {
		window.clearTimeout(previousTimer);
	}
	const nextTimer = window.setTimeout(() => {
		clearFlipStyles(container);
		flipCleanupTimers.delete(container);
	}, FLIP_ANIMATION_MS + 40);
	flipCleanupTimers.set(container, nextTimer);
}

export function measureDocumentRects(container: HTMLElement): DocumentRectMap {
	const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
	const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
	const rects: DocumentRectMap = new Map();
	for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-note-id]'))) {
		const id = node.dataset.noteId;
		if (!id) continue;
		const rect = node.getBoundingClientRect();
		rects.set(id, {
			left: rect.left + scrollX,
			top: rect.top + scrollY,
			width: rect.width,
			height: rect.height,
			centerX: rect.left + scrollX + rect.width / 2,
			centerY: rect.top + scrollY + rect.height / 2,
		});
	}
	return rects;
}

export function measureViewportRects(container: HTMLElement): ViewportRectMap {
	const rects: ViewportRectMap = new Map();
	for (const node of Array.from(container.querySelectorAll<HTMLElement>('[data-note-id]'))) {
		const id = node.dataset.noteId;
		if (!id) continue;
		rects.set(id, node.getBoundingClientRect());
	}
	return rects;
}

function runFlipAnimations<T extends RectSnapshot>(args: {
	container: HTMLElement;
	previousRects: Map<string, T>;
	measureRects: (container: HTMLElement) => Map<string, T>;
	activeId: string | null;
	suppressAnimations: boolean;
	skipForScroll: boolean;
	suppressUniformGlobalShift?: boolean;
}): Map<string, T> {
	const nextRects = args.measureRects(args.container);
	const nodes = Array.from(args.container.querySelectorAll<HTMLElement>('[data-note-id]'));
	const deltas: Array<{ node: HTMLElement; dx: number; dy: number }> = [];

	for (const node of nodes) {
		const id = node.dataset.noteId;
		if (!id || id === args.activeId) continue;
		const previous = args.previousRects.get(id);
		const current = nextRects.get(id);
		if (!previous || !current) continue;
		const dx = previous.left - current.left;
		const dy = previous.top - current.top;
		if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
		deltas.push({ node, dx, dy });
	}

	const hasUniformGlobalShift =
		deltas.length >= 2 &&
		deltas.every(({ dx, dy }) => {
			const base = deltas[0];
			return Math.abs(dx - base.dx) <= 1.5 && Math.abs(dy - base.dy) <= 1.5;
		});
	const shouldSuppressUniformGlobalShift = args.suppressUniformGlobalShift !== false;

	if (args.suppressAnimations || args.skipForScroll || (shouldSuppressUniformGlobalShift && hasUniformGlobalShift)) {
		const previousTimer = flipCleanupTimers.get(args.container);
		if (previousTimer && typeof window !== 'undefined') {
			window.clearTimeout(previousTimer);
			flipCleanupTimers.delete(args.container);
		}
		for (const { node } of deltas) {
			const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
			content.style.transition = 'none';
			content.style.transform = 'translate3d(0px, 0px, 0px)';
			content.style.willChange = '';
		}
		return nextRects;
	}

	for (const { node, dx, dy } of deltas) {
		const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
		content.style.transition = 'none';
		content.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
		content.style.willChange = 'transform';
		void content.getBoundingClientRect();
		content.style.transition = `transform ${FLIP_ANIMATION_MS}ms ${FLIP_EASING}`;
		content.style.transform = 'translate3d(0px, 0px, 0px)';
	}

	scheduleFlipCleanup(args.container);

	return nextRects;
}

export function applyFlipAnimations(args: {
	container: HTMLElement;
	previousRects: ViewportRectMap;
	activeId: string | null;
	suppressAnimations: boolean;
	skipForScroll: boolean;
	suppressUniformGlobalShift?: boolean;
}): ViewportRectMap {
	return runFlipAnimations({
		...args,
		measureRects: measureViewportRects,
	});
}

export function applyDocumentFlipAnimations(args: {
	container: HTMLElement;
	previousRects: DocumentRectMap;
	activeId: string | null;
	suppressAnimations: boolean;
	skipForScroll: boolean;
	suppressUniformGlobalShift?: boolean;
}): DocumentRectMap {
	return runFlipAnimations({
		...args,
		measureRects: measureDocumentRects,
	});
}
