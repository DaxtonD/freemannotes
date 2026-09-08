import React from 'react';
import { useWindowVirtualizer, type Virtualizer } from '@tanstack/react-virtual';
import { recordHeadingCollapseDebug } from '../../core/collapsibleHeadingCollapseDebug';
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

// Escape hatch so we can reproduce production's virtualization behavior on a dev
// server without seeding 40+ notes by hand. Prod only windows a column once it
// crosses ~18-20 notes; below that every card stays mounted forever and the entire
// estimate→measure→reposition churn (the source of the scroll-oscillation and the
// checklist item-count regrowth) simply never runs — which is why dev, with its
// small dataset, has been structurally blind to this whole class of bug.
//
// When forced on we drop BOTH the count threshold AND the overscan: a low overscan
// is essential, or a small dev list fits entirely inside the overscan window and
// nothing is ever actually unmounted/remounted, so the bug wouldn't reproduce.
//
// Deliberately a RUNTIME flag (URL param persisted to localStorage), not a
// build-time env gate: the dev server may be a real built deployment (its own DB,
// its own notes) where import.meta.env.DEV is false, so a DEV-gated flag would be
// stripped there and never help. This activates only in a browser that explicitly
// opted in via `?forceVirtualization=1`, so it's harmless even if the code ships to
// prod — it changes nothing for any visitor who didn't set the flag. The
// VITE_FORCE_VIRTUALIZATION env var is also honored (baked per-build) for the
// `npm run dev` convenience case. Same pattern as debugLogger.ts's runtime toggle.
const FORCE_VIRTUALIZATION_STORAGE_KEY = 'freemannotes.forceVirtualization';
const FORCED_MIN_ITEMS = 4;
const FORCED_OVERSCAN = 2;

function parseForceVirtualizationToggle(value: unknown): boolean | null {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
	if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
	return null;
}

const FORCE_VIRTUALIZATION = (() => {
	const envValue = parseForceVirtualizationToggle(import.meta.env.VITE_FORCE_VIRTUALIZATION);
	if (envValue !== null) return envValue;
	if (typeof window === 'undefined') return false;
	try {
		const url = new URL(window.location.href);
		const queryValue = parseForceVirtualizationToggle(url.searchParams.get('forceVirtualization'));
		if (queryValue !== null) {
			try {
				window.localStorage.setItem(FORCE_VIRTUALIZATION_STORAGE_KEY, queryValue ? '1' : '0');
			} catch {
				// Best effort only.
			}
			return queryValue;
		}
	} catch {
		// ignore malformed location state
	}
	try {
		return parseForceVirtualizationToggle(window.localStorage.getItem(FORCE_VIRTUALIZATION_STORAGE_KEY)) === true;
	} catch {
		return false;
	}
})();

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
			recordHeadingCollapseDebug('resizeObserver', { noteId: props.noteId, height, surface: 'virtual-column-item' });
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
	// Dev override lowers overscan too (see FORCE_VIRTUALIZATION note above) so a small
	// dev list actually windows instead of rendering everything within overscan.
	const effectiveOverscan = FORCE_VIRTUALIZATION ? FORCED_OVERSCAN : props.overscan;
	// Keep small columns fully mounted. The measurement churn of virtualization only
	// pays for itself once the column is tall enough to scroll meaningfully.
	const shouldVirtualize = props.enabled && props.noteIds.length >= (
		FORCE_VIRTUALIZATION
			? FORCED_MIN_ITEMS
			: Math.max(MIN_ITEMS_BEFORE_VIRTUALIZING, props.overscan * 2 + 8)
	);

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
	const noteIdsSignature = React.useMemo(() => props.noteIds.join('\u001f'), [props.noteIds]);

	const virtualizer = useWindowVirtualizer<HTMLDivElement>({
		count: props.noteIds.length,
		estimateSize,
		overscan: effectiveOverscan,
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
		// Remeasure when column membership/order changes, not just length — warm pin-order
		// fixes reorder ids without changing count and must refresh the virtual window.
		virtualizer.measure();
	}, [noteIdsSignature, scrollMargin, shouldVirtualize, virtualizer]);

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