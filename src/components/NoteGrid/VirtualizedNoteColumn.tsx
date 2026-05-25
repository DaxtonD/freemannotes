import React from 'react';
import { useWindowVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import styles from './NoteGrid.module.css';

type VirtualizedNoteColumnProps = {
	noteIds: readonly string[];
	estimateSize: (noteId: string) => number;
	renderItem: (noteId: string) => React.ReactNode;
	onItemHeightChange: (noteId: string, height: number) => void;
	gapPx: number;
	overscan: number;
	enabled: boolean;
};

type VirtualizedNoteColumnItemProps = {
	noteId: string;
	index: number;
	virtualizer: Virtualizer<Window, HTMLDivElement>;
	onItemHeightChange: (noteId: string, height: number) => void;
	children: React.ReactNode;
};

const MIN_ITEMS_BEFORE_VIRTUALIZING = 18;

const VirtualizedNoteColumnItem = React.memo(function VirtualizedNoteColumnItem(
	props: VirtualizedNoteColumnItemProps
): React.JSX.Element {
	const nodeRef = React.useRef<HTMLDivElement | null>(null);

	const handleRef = React.useCallback(
		(node: HTMLDivElement | null) => {
			nodeRef.current = node;
			if (!node) return;
			props.virtualizer.measureElement(node);
			const height = Math.round(node.getBoundingClientRect().height);
			if (height > 0) {
				props.onItemHeightChange(props.noteId, height);
			}
		},
		[props.noteId, props.onItemHeightChange, props.virtualizer]
	);

	React.useLayoutEffect(() => {
		const node = nodeRef.current;
		if (!node || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			const height = Math.round(entry?.contentRect.height ?? node.getBoundingClientRect().height);
			if (height > 0) {
				props.onItemHeightChange(props.noteId, height);
			}
			props.virtualizer.measureElement(node);
		});

		observer.observe(node);
		return () => {
			observer.disconnect();
		};
	}, [props.noteId, props.onItemHeightChange, props.virtualizer]);

	return (
		<div ref={handleRef} data-index={props.index} className={styles.virtualItemShell}>
			{props.children}
		</div>
	);
});

export function VirtualizedNoteColumn(props: VirtualizedNoteColumnProps): React.JSX.Element {
	const columnRef = React.useRef<HTMLDivElement | null>(null);
	const [scrollMargin, setScrollMargin] = React.useState(0);
	// Keep small columns fully mounted. The measurement churn of virtualization only
	// pays for itself once the column is tall enough to scroll meaningfully.
	const shouldVirtualize = props.enabled && props.noteIds.length >= Math.max(MIN_ITEMS_BEFORE_VIRTUALIZING, props.overscan * 2 + 8);

	React.useLayoutEffect(() => {
		if (typeof window === 'undefined') return;
		const node = columnRef.current;
		if (!node) return;

		// Measure each column's absolute top in the document so the virtualizer can
		// preserve browser-driven masonry positioning as responsive layout shifts.
		// Debounce via rAF: during framer-motion layout animations the column's
		// rect.top oscillates through intermediate values every frame.  Without
		// debouncing, each intermediate value triggers a setScrollMargin → virtualizer
		// remeasure → item position recalculation, which produces visible jitter.
		let rafId = 0;
		const updateScrollMargin = () => {
			if (rafId) return; // already scheduled
			rafId = window.requestAnimationFrame(() => {
				rafId = 0;
				const rect = node.getBoundingClientRect();
				const nextMargin = Math.max(0, Math.round(rect.top + window.scrollY));
				setScrollMargin((previous) => (previous === nextMargin ? previous : nextMargin));
			});
		};

		updateScrollMargin();
		const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateScrollMargin()) : null;
		observer?.observe(node);
		if (node.parentElement) observer?.observe(node.parentElement);
		window.addEventListener('resize', updateScrollMargin);
		window.addEventListener('orientationchange', updateScrollMargin);

		return () => {
			if (rafId) window.cancelAnimationFrame(rafId);
			observer?.disconnect();
			window.removeEventListener('resize', updateScrollMargin);
			window.removeEventListener('orientationchange', updateScrollMargin);
		};
	}, [props.enabled, props.noteIds.length]);

	const estimateSize = React.useCallback(
		(index: number) => {
			const noteId = props.noteIds[index] ?? '';
			return props.estimateSize(noteId);
		},
		[props.estimateSize, props.noteIds]
	);

	const getItemKey = React.useCallback(
		(index: number) => props.noteIds[index] ?? index,
		[props.noteIds]
	);

	const virtualizer = useWindowVirtualizer<HTMLDivElement>({
		count: props.noteIds.length,
		estimateSize,
		overscan: props.overscan,
		gap: props.gapPx,
		scrollMargin,
		getItemKey,
		enabled: shouldVirtualize,
		useFlushSync: false,
		measureElement: (element, entry) => Math.max(1, Math.round(entry?.contentRect.height ?? element.getBoundingClientRect().height)),
		shouldAdjustScrollPositionOnItemSizeChange: () => false,
	});

	React.useEffect(() => {
		if (!shouldVirtualize) return;
		virtualizer.measure();
	}, [scrollMargin, shouldVirtualize, virtualizer]);

	const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
	// Padding preserves the full column height in the DOM, so scroll position,
	// sticky layout caches, and drag/drop geometry still match the non-virtual grid.
	const leadingPaddingPx = shouldVirtualize && virtualItems.length > 0
		? Math.max(0, Math.round(virtualItems[0].start - scrollMargin))
		: 0;
	const trailingPaddingPx = shouldVirtualize && virtualItems.length > 0
		? Math.max(0, Math.round(virtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end))
		: 0;
	const renderedItems = shouldVirtualize
		? virtualItems.map((item) => ({ key: item.key, index: item.index, noteId: props.noteIds[item.index] ?? '' }))
		: props.noteIds.map((noteId, index) => ({ key: noteId, index, noteId }));

	return (
		<div ref={columnRef} className={styles.virtualColumn}>
			<div
				className={styles.virtualColumnInner}
				style={shouldVirtualize ? { paddingTop: `${leadingPaddingPx}px`, paddingBottom: `${trailingPaddingPx}px` } : undefined}
			>
				{renderedItems.map((item) => (
					<VirtualizedNoteColumnItem
						key={item.key}
						noteId={item.noteId}
						index={item.index}
						virtualizer={virtualizer}
						onItemHeightChange={props.onItemHeightChange}
					>
						{props.renderItem(item.noteId)}
					</VirtualizedNoteColumnItem>
				))}
			</div>
		</div>
	);
}