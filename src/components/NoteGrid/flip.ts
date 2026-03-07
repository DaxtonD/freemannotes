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

export function applyFlipAnimations(args: {
	container: HTMLElement;
	previousRects: ViewportRectMap;
	activeId: string | null;
	suppressAnimations: boolean;
	skipForScroll: boolean;
}): ViewportRectMap {
	const nextRects = measureViewportRects(args.container);
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

	if (args.suppressAnimations || args.skipForScroll || hasUniformGlobalShift) {
		for (const { node } of deltas) {
			const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
			content.style.transition = 'none';
			content.style.transform = 'translate(0px, 0px)';
		}
		return nextRects;
	}

	for (const { node, dx, dy } of deltas) {
		const content = (node.querySelector('[data-note-content="true"]') as HTMLElement | null) ?? node;
		content.style.transition = 'none';
		content.style.transform = `translate(${dx}px, ${dy}px)`;
		void content.getBoundingClientRect();
		content.style.transition = 'transform 180ms ease-out';
		content.style.transform = 'translate(0px, 0px)';
	}

	return nextRects;
}
