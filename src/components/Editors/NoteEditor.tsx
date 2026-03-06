import React, { useMemo, useSyncExternalStore } from 'react';
import {
	DragDropContext,
	Draggable,
	Droppable,
	type BeforeCapture,
	type DragStart,
	type DragUpdate,
	type DropResult,
} from '@hello-pangea/dnd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
	faAlignCenter,
	faAlignLeft,
	faAlignRight,
	faBell,
	faBold,
	faImage,
	faEllipsisVertical,
	faGripVertical,
	faItalic,
	faListOl,
	faListUl,
	faLink,
	faPalette,
	faUnderline,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { byPrefixAndName } from '../../core/byPrefixAndName';
import type { ChecklistItem } from '../../core/bindings';
import { applyChecklistDragToItems, normalizeChecklistHierarchy, removeChecklistItemWithChildren } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useIsMobileLandscape } from '../../core/useIsMobileLandscape';
import styles from './Editors.module.css';

export type NoteEditorProps = {
	noteId: string;
	doc: Y.Doc;
	onClose: () => void;
	onDelete: (noteId: string) => Promise<void>;
};

type NoteType = 'text' | 'checklist';

const EMPTY_ITEMS: readonly ChecklistItem[] = [];

function materializeChecklistItems(yarray: Y.Array<Y.Map<any>>): readonly ChecklistItem[] {
	return yarray
		.toArray()
		.map((m) => ({
			id: String(m.get('id') ?? ''),
			text: String(m.get('text') ?? ''),
			completed: Boolean(m.get('completed')),
			parentId:
				typeof m.get('parentId') === 'string' && String(m.get('parentId')).trim().length > 0
					? String(m.get('parentId')).trim()
					: null,
		}))
		.filter((item) => item.id.length > 0);
}

function updateChecklistItemById(
	yarray: Y.Array<Y.Map<any>>,
	id: string,
	patch: Partial<Omit<ChecklistItem, 'id'>>
): void {
	const normalizedId = String(id ?? '').trim();
	if (!normalizedId) return;

	const arr = yarray.toArray();
	let idx = -1;
	for (let i = 0; i < arr.length; i++) {
		if (String(arr[i].get('id') ?? '').trim() === normalizedId) {
			idx = i;
			break;
		}
	}
	if (idx === -1) return;

	const doc = (yarray as any).doc as Y.Doc | null | undefined;
	const apply = (): void => {
		const m = yarray.get(idx);
		if (!m) return;
		if (patch.text !== undefined) m.set('text', String(patch.text));
		if (patch.completed !== undefined) m.set('completed', Boolean(patch.completed));
		if (patch.parentId !== undefined) {
			const parentId = typeof patch.parentId === 'string' ? patch.parentId.trim() : null;
			m.set('parentId', parentId && parentId.length > 0 ? parentId : null);
		}
	};
	if (doc) doc.transact(apply);
	else apply();
}


function autoResizeTextarea(textarea: HTMLTextAreaElement | null): void {
	if (!textarea) return;
	textarea.style.height = '0px';
	textarea.style.height = `${Math.max(26, textarea.scrollHeight)}px`;
	const style = window.getComputedStyle(textarea);
	const fontSize = Number.parseFloat(style.fontSize || '0') || 16;
	const parsedLineHeight = Number.parseFloat(style.lineHeight || '0') || 0;
	const lineHeight = parsedLineHeight > 0 ? parsedLineHeight : fontSize * 1.35;
	const paddingTop = Number.parseFloat(style.paddingTop || '0') || 0;
	const paddingBottom = Number.parseFloat(style.paddingBottom || '0') || 0;
	const expectedSingleLine = Math.ceil(lineHeight + paddingTop + paddingBottom + 2);
	const isMultiline = textarea.scrollHeight > expectedSingleLine + 6;
	const row = textarea.closest(`.${styles.checklistItem}, .${styles.checklistComposerRow}`);
	if (row instanceof HTMLElement) {
		row.classList.toggle(styles.rowMultiline, isMultiline);
	}
}

// Write helper for Y.Text that applies a minimal diff and falls back to full replace if needed.
function setYTextValue(ytext: Y.Text, next: string): void {
	const prev = ytext.toString();
	if (prev === next) return;

	let start = 0;
	const prevLen = prev.length;
	const nextLen = next.length;
	const minLen = prevLen < nextLen ? prevLen : nextLen;
	while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
		start++;
	}

	let prevEnd = prevLen - 1;
	let nextEnd = nextLen - 1;
	while (prevEnd >= start && nextEnd >= start && prev.charCodeAt(prevEnd) === next.charCodeAt(nextEnd)) {
		prevEnd--;
		nextEnd--;
	}

	const deleteLen = prevEnd >= start ? prevEnd - start + 1 : 0;
	const insertText = nextEnd >= start ? next.slice(start, nextEnd + 1) : '';

	const doc = (ytext as any).doc as Y.Doc | null | undefined;
	const apply = (): void => {
		if (deleteLen > 0) ytext.delete(start, deleteLen);
		if (insertText.length > 0) ytext.insert(start, insertText);
	};

	if (doc) doc.transact(apply);
	else apply();

	if (ytext.toString() !== next) {
		const fallback = (): void => {
			ytext.delete(0, ytext.length);
			if (next.length > 0) ytext.insert(0, next);
		};
		if (doc) doc.transact(fallback);
		else fallback();
	}
}

function useYTextValue(ytext: Y.Text): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext.toString(),
		() => ytext.toString()
	);
}

// Safe optional variant used when a note mode does not expose a given Y.Text.
function useOptionalYTextValue(ytext: Y.Text | null): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			if (!ytext) return () => {};
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext?.toString() ?? '',
		() => ytext?.toString() ?? ''
	);
}

// Subscribe to metadata keys for reactive note-type rendering.
function useMetadataString(metadata: Y.Map<any>, key: string): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => metadata.unobserve(observer);
		},
		() => String(metadata.get(key) ?? ''),
		() => String(metadata.get(key) ?? '')
	);
}

// Checklist subscription helper for conditional checklist notes.
function useOptionalChecklistItems(yarray: Y.Array<Y.Map<any>> | null): readonly ChecklistItem[] {
	const cacheRef = React.useRef<{
		yarray: Y.Array<Y.Map<any>> | null;
		items: readonly ChecklistItem[];
	}>(
		// Initialize with a stable empty reference so React can compare snapshots.
		{ yarray: null, items: EMPTY_ITEMS }
	);

	return useSyncExternalStore(
		(onStoreChange) => {
			if (!yarray) return () => {};
			// Prime cache on first subscription (and whenever the yarray instance changes).
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}

			const observer = (): void => {
				// Update the cached snapshot BEFORE notifying React.
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
				onStoreChange();
			};
			yarray.observeDeep(observer);
			return () => yarray.unobserveDeep(observer);
		},
		() => {
			if (!yarray) return EMPTY_ITEMS;
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		},
		() => {
			if (!yarray) return EMPTY_ITEMS;
			if (cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		}
	);
}

export function NoteEditor(props: NoteEditorProps): React.JSX.Element {
	const getInitialInteractionGuardState = (): boolean => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
		return window.matchMedia('(pointer: coarse)').matches;
	};
	const { t } = useI18n();
	const [isModified, setIsModified] = React.useState(false);
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1>(0);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState<boolean>(getInitialInteractionGuardState);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: force media dock closed to keep editing chrome stable.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
	React.useEffect(() => {
		// Coarse-pointer branch: start with a longer guard window because this
		// editor has dense interactive checklist controls near the tap origin.
		if (!isCoarsePointer || typeof window === 'undefined') return;
		setInteractionGuardActive(true);
		const timeoutId = window.setTimeout(() => setInteractionGuardActive(false), 700);
		return () => window.clearTimeout(timeoutId);
	}, [isCoarsePointer]);
	const dockTouchStartRef = React.useRef<{ x: number; y: number } | null>(null);
	const handleInteractionGuardEvent = React.useCallback((event: React.SyntheticEvent): void => {
		if (!interactionGuardActive) return;
		event.preventDefault();
		event.stopPropagation();
	}, [interactionGuardActive]);
	const handleTouchStart = React.useCallback((event: React.TouchEvent): void => {
		const t0 = event.touches[0];
		if (!t0) return;
		event.stopPropagation();
		dockTouchStartRef.current = { x: t0.clientX, y: t0.clientY };
	}, []);
	const handleDockTouchMove = React.useCallback((event: React.TouchEvent): void => {
		if (!dockTouchStartRef.current) return;
		event.stopPropagation();
		if (event.cancelable) event.preventDefault();
	}, []);
	const handleHandleTouchEnd = React.useCallback(
		(event: React.TouchEvent): void => {
			// Landscape branch: never open/close media via vertical swipes.
			if (isMobileLandscapeRef.current) return;
			const start = dockTouchStartRef.current;
			const t0 = event.changedTouches[0];
			if (!start || !t0) return;
			event.stopPropagation();
			if (event.cancelable) event.preventDefault();
			dockTouchStartRef.current = null;
			const dx = t0.clientX - start.x;
			const dy = t0.clientY - start.y;
			if (Math.abs(dy) < 28 || Math.abs(dy) < Math.abs(dx)) return;
			if (dy < 0) setMediaDockOpen(true);
			if (dy > 0) setMediaDockOpen(false);
		},
		[]
	);
	const handleDockSwipeEnd = React.useCallback(
		(event: React.TouchEvent): void => {
			// Landscape branch: horizontal media tab swipe is disabled.
			if (isMobileLandscapeRef.current) return;
			const start = dockTouchStartRef.current;
			const t0 = event.changedTouches[0];
			if (!start || !t0) return;
			event.stopPropagation();
			dockTouchStartRef.current = null;
			const dx = t0.clientX - start.x;
			const dy = t0.clientY - start.y;
			if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy)) return;
			setMediaDockTab((prev) => {
				if (dx < 0) return (prev === 0 ? 1 : prev);
				return (prev === 1 ? 0 : prev);
			});
		},
		[]
	);
	const [showCompleted, setShowCompleted] = React.useState(false);
	const checklistArray = useMemo(() => props.doc.getArray<Y.Map<any>>('checklist'), [props.doc]);
	const rowInputsRef = React.useRef<Map<string, HTMLTextAreaElement | null>>(new Map());
	const rowContainersRef = React.useRef<Map<string, HTMLLIElement | null>>(new Map());
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; rowHeight: number | null; textHeight: number | null; textWidth: number | null }>({
		rowWidth: null,
		rowHeight: null,
		textHeight: null,
		textWidth: null,
	});

	React.useEffect(() => {
		setIsModified(false);
		const onAfterTransaction = (tr: Y.Transaction): void => {
			if (!tr.local) return;
			setIsModified(true);
		};
		props.doc.on('afterTransaction', onAfterTransaction);
		return () => {
			props.doc.off('afterTransaction', onAfterTransaction);
		};
	}, [props.doc, props.noteId]);
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const lastOverIndexRef = React.useRef<number | null>(null);
	const [draggingParentId, setDraggingParentId] = React.useState<string | null>(null);
	const [isChecklistDragging, setIsChecklistDragging] = React.useState(false);


	// metadata.type controls which editor body is rendered.
	const metadata = useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';

	const titleYText = useMemo(() => props.doc.getText('title'), [props.doc]);
	const contentYText = useMemo(() => (type === 'text' ? props.doc.getText('content') : null), [props.doc, type]);
	const title = useYTextValue(titleYText);
	const content = useOptionalYTextValue(contentYText);
	const items = useOptionalChecklistItems(type === 'checklist' ? checklistArray : null);
	const normalizedItems = useMemo(() => normalizeChecklistHierarchy(items), [items]);
	const activeItems = useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedItems = useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);

	// FLIP animation helper for checklist indent/un-indent (horizontal snap):
	// When we indent/unindent we mutate the *flat* list (parentId changes + regrouping),
	// which can visually look like items “teleport” to a new place.
	//
	// The hook gives us a `capturePositions()` callback: call it immediately BEFORE we
	// apply the hierarchy mutation so the next render can animate items from their
	// previous rects to their new rects.
	const { capturePositions: captureFlipPositions } = useChecklistFlip(rowContainersRef, normalizedItems);
	const captureFlipPositionsRef = React.useRef(captureFlipPositions);
	captureFlipPositionsRef.current = captureFlipPositions;

	React.useEffect(() => {
		if (!focusRowId) return;
		const target = rowInputsRef.current.get(focusRowId);
		autoResizeTextarea(target);
		target?.focus();
		setFocusRowId(null);
	}, [focusRowId, items]);

	React.useLayoutEffect(() => {
		for (const textarea of rowInputsRef.current.values()) {
			autoResizeTextarea(textarea);
		}
	}, [items, showCompleted]);

	// Re-measure textarea heights when the container width changes (window resize):
	// Checklist rows use auto-growing textareas where height depends on text wrapping.
	// Without a resize listener, shrinking/growing the editor can change wrapping but
	// leave stale heights, causing clipped text until the user types.
	//
	// We rAF-debounce to avoid forced layout on every resize event.
	React.useEffect(() => {
		let rafId = 0;
		const onResize = (): void => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				for (const textarea of rowInputsRef.current.values()) {
					autoResizeTextarea(textarea);
				}
			});
		};
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('resize', onResize);
			cancelAnimationFrame(rafId);
		};
	}, []);

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent:
	// We detect a deliberate horizontal gesture (see `dndSensors.ts`) and then perform
	// the hierarchy mutation directly. This keeps the vertical drag library focused on
	// reorder only, and prevents the “drag started then got cancelled” flicker.
	//
	// We store current values in refs so the handler stays registered once, but still
	// reads fresh `normalizedItems` and `replaceChecklistItems` on every invocation.
	const normalizedItemsRef = React.useRef<readonly ChecklistItem[]>(normalizedItems);
	normalizedItemsRef.current = normalizedItems;
	const replaceChecklistItemsRef = React.useRef<((next: readonly ChecklistItem[]) => void) | null>(null);

	React.useEffect(() => {
		if (type !== 'checklist') return;
		return registerHorizontalSnapHandler((draggableId, direction) => {
			// Capture pre-mutation layout for FLIP before we change parentId/grouping.
			captureFlipPositionsRef.current();
			const currentItems = normalizedItemsRef.current;
			const currentActive = currentItems.filter((item) => !item.completed);
			const sourceIndex = currentActive.findIndex((item) => item.id === draggableId);
			if (sourceIndex === -1) return;
			const nextItems = applyChecklistDragToItems({
				items: currentItems,
				sourceIndex,
				destinationIndex: sourceIndex,
				axis: 'horizontal',
				horizontalDirection: direction,
			});
			replaceChecklistItemsRef.current?.(nextItems);
		});
	}, [type]);

	React.useEffect(() => {
		const clearInitialFocus = (): void => {
			const active = document.activeElement;
			if (active instanceof HTMLElement) {
				active.blur();
			}
			window.getSelection?.()?.removeAllRanges();
		};

		// Focus suppression branch:
		// - coarse pointer: use longer suppression to outlast delayed compat events
		// - fine pointer: keep tight to avoid interfering with normal desktop focus
		const suppressUntil = performance.now() + (isCoarsePointer ? 700 : 220);
		const onFocusIn = (event: FocusEvent): void => {
			if (performance.now() > suppressUntil) return;
			const target = event.target;
			if (target instanceof HTMLElement) {
				target.blur();
			}
			window.getSelection?.()?.removeAllRanges();
		};

		clearInitialFocus();
		const rafIdA = window.requestAnimationFrame(clearInitialFocus);
		const rafIdB = window.requestAnimationFrame(() => {
			clearInitialFocus();
		});
		document.addEventListener('focusin', onFocusIn, true);
		const timeoutId = window.setTimeout(() => {
			document.removeEventListener('focusin', onFocusIn, true);
		}, isCoarsePointer ? 700 : 220);

		return () => {
			window.cancelAnimationFrame(rafIdA);
			window.cancelAnimationFrame(rafIdB);
			window.clearTimeout(timeoutId);
			document.removeEventListener('focusin', onFocusIn, true);
		};
	}, [isCoarsePointer, props.noteId]);

	const addChecklistItem = React.useCallback(
		(index?: number): void => {
			if (type !== 'checklist') return;
			const nextId =
				typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
					? crypto.randomUUID()
					: String(Date.now());
			const insertIndex = typeof index === 'number' ? Math.max(0, Math.min(items.length, index + 1)) : items.length;

			const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
			const apply = (): void => {
				const map = new Y.Map<any>();
				map.set('id', nextId);
				map.set('text', '');
				map.set('completed', false);
				map.set('parentId', null);
				checklistArray.insert(insertIndex, [map]);
			};

			if (doc) doc.transact(apply);
			else apply();
			setFocusRowId(nextId);
		},
		[checklistArray, items.length, type]
	);

	const replaceChecklistItems = React.useCallback(
		(nextItems: readonly ChecklistItem[]): void => {
			const doc = (checklistArray as any).doc as Y.Doc | null | undefined;
			const apply = (): void => {
				checklistArray.delete(0, checklistArray.length);
				const maps = nextItems.map((entry) => {
					const map = new Y.Map<any>();
					map.set('id', entry.id);
					map.set('text', entry.text);
					map.set('completed', entry.completed);
					map.set('parentId', entry.parentId);
					return map;
				});
				checklistArray.insert(0, maps);
			};

			if (doc) doc.transact(apply);
			else apply();
		},
		[checklistArray]
	);

	// Now that replaceChecklistItems is defined, keep the ref current.
	replaceChecklistItemsRef.current = replaceChecklistItems;

	const toggleChecklistCompleted = React.useCallback(
		(id: string, checked: boolean): void => {
			if (type !== 'checklist') return;
			const childIds = new Set(normalizedItems.filter((item) => item.parentId === id).map((item) => item.id));
			for (const item of normalizedItems) {
				if (item.id === id || childIds.has(item.id)) {
					updateChecklistItemById(checklistArray, item.id, { completed: checked });
				}
			}
		},
		[checklistArray, normalizedItems, type]
	);

	const removeChecklistItem = React.useCallback(
		(id: string): void => {
			if (type !== 'checklist') return;
			const index = normalizedItems.findIndex((row) => row.id === id);
			const previousId = index > 0 ? normalizedItems[index - 1]?.id ?? null : null;
			const nextId = normalizedItems[index + 1]?.id ?? null;
			const nextItems = removeChecklistItemWithChildren(normalizedItems, id);
			replaceChecklistItems(nextItems);
			setFocusRowId(previousId ?? nextId);
		},
		[normalizedItems, replaceChecklistItems, type]
	);

	const onChecklistDragEnd = React.useCallback(
		(event: DropResult): void => {
			if (!event.destination) return;
			const axis = getChecklistDragAxis() ?? 'vertical';
			const horizontalDirection = getChecklistHorizontalDirection();
			const nextItems = applyChecklistDragToItems({
				items: normalizedItems,
				sourceIndex: event.source.index,
				destinationIndex: event.destination.index,
				axis,
				horizontalDirection,
			});
			replaceChecklistItems(nextItems);
			setDraggingParentId(null);
			dragGhostMetricsRef.current = { rowWidth: null, rowHeight: null, textHeight: null, textWidth: null };
			resetChecklistDragAxis();
		},
		[normalizedItems, replaceChecklistItems]
	);

	// Drag-ghost measurement (desktop + mobile):
	// The drag “clone” should match what the user picked up pixel-perfectly.
	// Multi-line checklist items are especially sensitive because wrapping depends
	// on the *exact* text container width.
	//
	// We measure both the overall row width and the text element width:
	// - `rowWidth` sizes the outer <li> so padding/controls match.
	// - `textWidth` sizes the text block so wrapping matches, preventing the
	//   “ghost is wider/narrower and wraps differently” regressions.
	const captureDragGhostMetrics = React.useCallback((id: string): void => {
		const rowNode = rowContainersRef.current.get(id);
		const textNode = rowInputsRef.current.get(id);
		const rowRect = rowNode?.getBoundingClientRect();
		const textRect = textNode?.getBoundingClientRect();
		dragGhostMetricsRef.current = {
			rowWidth: rowRect ? Math.ceil(rowRect.width) : null,
			rowHeight: rowRect ? Math.ceil(rowRect.height) : null,
			textHeight: textNode ? Math.max(26, Math.ceil(textNode.scrollHeight) + 2) : null,
			textWidth: textRect ? Math.ceil(textRect.width) : null,
		};
	}, []);

	const clearChecklistRowSelection = React.useCallback((): void => {
		const active = document.activeElement;
		if (active instanceof HTMLElement) {
			active.blur();
		}
		window.getSelection?.()?.removeAllRanges();
	}, []);

	const measureChecklistRowIsMultiline = React.useCallback((id: string): boolean => {
		const node = rowInputsRef.current.get(id);
		if (!node) return false;
		const style = window.getComputedStyle(node);
		const fontSize = Number.parseFloat(style.fontSize || '0') || 16;
		const parsedLineHeight = Number.parseFloat(style.lineHeight || '0') || 0;
		const lineHeight = parsedLineHeight > 0 ? parsedLineHeight : fontSize * 1.35;
		const paddingTop = Number.parseFloat(style.paddingTop || '0') || 0;
		const paddingBottom = Number.parseFloat(style.paddingBottom || '0') || 0;
		// Heuristic: treat the row as multi-line if its scrollHeight is meaningfully
		// larger than the expected single-line height.
		const expectedSingleLine = Math.ceil(lineHeight + paddingTop + paddingBottom + 2);
		return node.scrollHeight > expectedSingleLine + 6;
	}, []);

	const vibrateIfAvailable = React.useCallback((ms: number): void => {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
		navigator.vibrate(ms);
	}, []);

	const onChecklistDragStart = React.useCallback(
		(event: DragStart): void => {
			setIsChecklistDragging(true);
			clearChecklistRowSelection();
			// Desktop ghost sizing notes:
			// - @hello-pangea/dnd can apply inline styles at drag start that subtly
			//   change the measured width/height of the dragged row (especially with
			//   flex + textarea auto-sizing).
			// - We capture measurements in `onBeforeCapture` while the DOM is still in
			//   its stable, pre-drag state.
			// - This `onDragStart` measurement is only a safety net (e.g. if refs were
			//   not yet populated for a freshly-mounted row).
			if (dragGhostMetricsRef.current.rowWidth === null || dragGhostMetricsRef.current.textHeight === null) {
				captureDragGhostMetrics(event.draggableId);
			}
			resetChecklistDragAxis();
			const dragged = activeItems.find((item) => item.id === event.draggableId) ?? null;
			if (dragged && !dragged.parentId) {
				const hasChildren = activeItems.some((item) => item.parentId === dragged.id);
				setDraggingParentId(hasChildren ? dragged.id : null);
			} else {
				setDraggingParentId(null);
			}
			lastOverIndexRef.current = null;
			vibrateIfAvailable(12);
		},
		[activeItems, captureDragGhostMetrics, clearChecklistRowSelection, vibrateIfAvailable]
	);

	const onChecklistBeforeCapture = React.useCallback(
		(before: BeforeCapture): void => {
			// Capture the dragged row's dimensions *before* the drag begins so the
			// clone/ghost can be sized to exactly match what the user picked up.
			// This avoids narrow/overshooting ghosts caused by drag-time transforms.
			captureDragGhostMetrics(before.draggableId);
		},
		[captureDragGhostMetrics]
	);

	const onChecklistDragUpdate = React.useCallback(
		(event: DragUpdate): void => {
			const nextIndex = event.destination?.index ?? null;
			if (nextIndex === null) return;
			if (lastOverIndexRef.current === nextIndex) return;
			lastOverIndexRef.current = nextIndex;
			vibrateIfAvailable(6);
		},
		[vibrateIfAvailable]
	);

	const onChecklistKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>, rowId: string): void => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				const currentIndex = activeItems.findIndex((row) => row.id === rowId);
				addChecklistItem(currentIndex);
				return;
			}

			if (event.key === 'Backspace') {
				const current = activeItems.find((row) => row.id === rowId);
				if (!current || current.text.length > 0) return;
				event.preventDefault();
				removeChecklistItem(rowId);
			}
		},
		[activeItems, addChecklistItem, removeChecklistItem]
	);

	const renderChecklistClone = React.useCallback(
		(
			dragProvided: import('@hello-pangea/dnd').DraggableProvided,
			_snapshot: import('@hello-pangea/dnd').DraggableStateSnapshot,
			rubric: import('@hello-pangea/dnd').DraggableRubric
		): React.JSX.Element => {
			const dragged = activeItems.find((item) => item.id === rubric.draggableId) ?? null;
			const { rowWidth, textHeight, textWidth } = dragGhostMetricsRef.current;
			const isMultilineClone = (textHeight ?? 0) > 30;

			return (
				<li
					ref={dragProvided.innerRef}
					{...dragProvided.draggableProps}
					className={`${styles.checklistItem}${isMultilineClone ? ` ${styles.rowMultiline}` : ''} ${styles.rowDragging} ${styles.dragGhost}`}
					style={{ ...(dragProvided.draggableProps.style ?? {}), width: rowWidth ?? undefined, boxSizing: 'border-box' }}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					{/*
						Clone sizing:
						- Fixing width prevents re-wrapping relative to the original row.
						- Fixing height prevents the clone from shrinking/expanding mid-drag.
					*/}
					<div className={styles.dragPreviewText} style={{ height: textHeight ?? undefined, width: textWidth ?? undefined, flex: '0 0 auto' }}>
						{dragged?.text ?? ''}
					</div>
				</li>
			);
		},
		[activeItems, t]
	);

	return (
		<div className={styles.fullscreenOverlay} role="presentation" onClick={mediaDockOpen ? undefined : props.onClose}>
			<section
				aria-label={`Editor ${props.noteId}`}
				className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}`}
				onClick={(event) => event.stopPropagation()}
			>
				{type === 'checklist' ? (
					<header className={styles.editorTopBar}>
						<button type="button" className={styles.closeIconButton} onClick={props.onClose} aria-label={t('common.close')}>
							✕
						</button>
					</header>
				) : null}

				{type === 'checklist' ? (
					<input
						className={styles.editorTitleInput}
						value={title}
						onChange={(e) => setYTextValue(titleYText, e.target.value)}
						placeholder={t('editors.titlePlaceholder')}
					/>
				) : (
					<input
						className={styles.editorTitleInput}
						value={title}
						onChange={(e) => setYTextValue(titleYText, e.target.value)}
						placeholder={t('editors.titlePlaceholder')}
					/>
				)}

				{type === 'text' && contentYText ? (
					<>
						<div className={styles.formatToolbar} role="toolbar" aria-label={t('editors.formatting')}>
							<div className={styles.formatToolbarRow}>
								<button type="button" className={styles.formatButton} aria-label={t('editors.bold')} title={t('editors.bold')}>
									<FontAwesomeIcon icon={faBold} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.italic')} title={t('editors.italic')}>
									<FontAwesomeIcon icon={faItalic} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.underline')} title={t('editors.underline')}>
									<FontAwesomeIcon icon={faUnderline} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.heading1')} title={t('editors.heading1')}>
									H1
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.heading2')} title={t('editors.heading2')}>
									H2
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.heading3')} title={t('editors.heading3')}>
									H3
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.bulletedList')} title={t('editors.bulletedList')}>
									<FontAwesomeIcon icon={faListUl} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.numberedList')} title={t('editors.numberedList')}>
									<FontAwesomeIcon icon={faListOl} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.alignLeft')} title={t('editors.alignLeft')}>
									<FontAwesomeIcon icon={faAlignLeft} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.alignCenter')} title={t('editors.alignCenter')}>
									<FontAwesomeIcon icon={faAlignCenter} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.alignRight')} title={t('editors.alignRight')}>
									<FontAwesomeIcon icon={faAlignRight} />
								</button>
								<button type="button" className={styles.formatButton} aria-label={t('editors.link')} title={t('editors.link')}>
									<FontAwesomeIcon icon={faLink} />
								</button>
							</div>
						</div>
						<textarea
							value={content}
							onChange={(e) => setYTextValue(contentYText, e.target.value)}
							rows={10}
							placeholder={t('editors.startTyping')}
							className={styles.fullBodyField}
						/>
					</>
				) : null}

				{type === 'checklist' ? (
					<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
						<div className={`${styles.formatToolbar} ${styles.formatToolbarCompact}`} role="toolbar" aria-label={t('editors.formatting')}>
							<div className={styles.formatToolbarRow}>
								<button type="button" className={`${styles.formatButton} ${styles.formatButtonCompact}`} aria-label={t('editors.bold')} title={t('editors.bold')}>
									<FontAwesomeIcon icon={faBold} />
								</button>
								<button type="button" className={`${styles.formatButton} ${styles.formatButtonCompact}`} aria-label={t('editors.italic')} title={t('editors.italic')}>
									<FontAwesomeIcon icon={faItalic} />
								</button>
								<button type="button" className={`${styles.formatButton} ${styles.formatButtonCompact}`} aria-label={t('editors.underline')} title={t('editors.underline')}>
									<FontAwesomeIcon icon={faUnderline} />
								</button>
								<button type="button" className={`${styles.formatButton} ${styles.formatButtonCompact}`} aria-label={t('editors.link')} title={t('editors.link')}>
									<FontAwesomeIcon icon={faLink} />
								</button>
							</div>
						</div>

						<div className={styles.checklistScrollArea}>
							<DragDropContext
								enableDefaultSensors={false}
								sensors={immediateChecklistSensors}
								onBeforeCapture={onChecklistBeforeCapture}
								onDragStart={onChecklistDragStart}
								onDragUpdate={onChecklistDragUpdate}
								onDragEnd={(event) => {
									lastOverIndexRef.current = null;
									onChecklistDragEnd(event);
									setIsChecklistDragging(false);
									setDraggingParentId(null);
									resetChecklistDragAxis();
								}}
							>
								<Droppable droppableId={`note-editor-active-${props.noteId}`} renderClone={renderChecklistClone}>
									{(dropProvided) => (
										<ul className={`${styles.checklistList}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`} ref={dropProvided.innerRef} {...dropProvided.droppableProps}>
											{activeItems.map((item, index) => (
												<Draggable key={item.id} draggableId={item.id} index={index} disableInteractiveElementBlocking>
													{(dragProvided, snapshot) => (
														<li
															ref={(node) => {
																dragProvided.innerRef(node);
																rowContainersRef.current.set(item.id, node);
															}}
															{...dragProvided.draggableProps}
															className={`${styles.checklistItem}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
															aria-label={t('editors.dragHandle')}
															style={{
																...(dragProvided.draggableProps.style ?? {}),
															}}
														>
															<button
																type="button"
																className={styles.dragHandle}
																aria-label={t('editors.dragHandle')}
																title={t('editors.dragHandle')}
																{...dragProvided.dragHandleProps}
															>
																<FontAwesomeIcon icon={faGripVertical} />
															</button>
															<input
																type="checkbox"
																className={styles.checklistCheckbox}
																checked={item.completed}
																onChange={(event) => toggleChecklistCompleted(item.id, event.target.checked)}
															/>
															<textarea
																ref={(node) => rowInputsRef.current.set(item.id, node)}
																value={item.text}
																onChange={(event) => {
																	updateChecklistItemById(checklistArray, item.id, { text: event.target.value });
																	autoResizeTextarea(event.currentTarget);
																}}
																onInput={(event) => autoResizeTextarea(event.currentTarget)}
																onKeyDown={(event) => onChecklistKeyDown(event, item.id)}
																className={styles.rowTextArea}
																rows={1}
															/>
															<button
																type="button"
																className={styles.rowRemoveButton}
																onClick={() => removeChecklistItem(item.id)}
																aria-label={t('editors.remove')}
																title={t('editors.remove')}
															>
																×
															</button>
														</li>
													)}
												</Draggable>
											))}
											{dropProvided.placeholder}
										</ul>
									)}
								</Droppable>
							</DragDropContext>
							

						{completedItems.length > 0 ? (
							<section className={styles.completedSection}>
								<button
									type="button"
									className={styles.completedToggle}
									onClick={() => setShowCompleted((prev) => !prev)}
								>
									{showCompleted ? '▾' : '▸'} {completedItems.length} {t('editors.completedItems')}
								</button>
								{showCompleted ? (
									<ul className={`${styles.checklistList}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}>
										{completedItems.map((item) => (
											<li key={item.id} className={`${styles.checklistItem}${item.parentId ? ` ${styles.childRow}` : ''}`}>
												<div className={styles.dragHandle} aria-hidden="true">
															<FontAwesomeIcon icon={faGripVertical} />
												</div>
												<input
													type="checkbox"
													className={styles.checklistCheckbox}
													checked={item.completed}
														onChange={(event) => toggleChecklistCompleted(item.id, event.target.checked)}
												/>
												<textarea
													value={item.text}
													onChange={(event) => {
															updateChecklistItemById(checklistArray, item.id, { text: event.target.value });
														autoResizeTextarea(event.currentTarget);
													}}
													onInput={(event) => autoResizeTextarea(event.currentTarget)}
													className={styles.rowTextArea}
													rows={1}
												/>
												<button
													type="button"
													className={styles.rowRemoveButton}
													onClick={() => removeChecklistItem(item.id)}
													aria-label={t('editors.remove')}
													title={t('editors.remove')}
												>
													×
												</button>
											</li>
										))}
									</ul>
								) : null}
							</section>
						) : null}
						</div>
					</section>
				) : null}

				<div className={styles.editorBottomArea}>
					<section className={styles.mediaDock} aria-label={t('editors.mediaDock')}>
						<button
							type="button"
							className={styles.mediaDockHandle}
							onClick={() => {
								if (isMobileLandscapeRef.current) return;
								setMediaDockOpen((prev) => !prev);
							}}
							onTouchStart={handleTouchStart}
							onTouchMove={handleDockTouchMove}
							onTouchEnd={handleHandleTouchEnd}
							aria-label={t('editors.mediaDock')}
						>
							<span className={styles.mediaDockPill} aria-hidden="true" />
							<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
						</button>
					</section>

					<nav className={`${styles.bottomDock}${type === 'checklist' ? ` ${styles.bottomDockCompact}` : ''}`} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faPalette} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
							<button type="button" className={`${styles.bottomDockButton}${type === 'checklist' ? ` ${styles.bottomDockButtonCompact}` : ''}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faImage} />
							</button>
							<button
								type="button"
								className={styles.mediaDockText}
								onClick={() => {
									if (isMobileLandscapeRef.current) return;
									setMediaDockOpen((prev) => !prev);
								}}
								aria-label={t('editors.mediaDock')}
							>
								{t('editors.mediaTabMedia')}
							</button>
						</div>
						<button type="button" className={styles.bottomDockClose} onClick={props.onClose} aria-label={t('common.close')} title={t('common.close')}>
							<FontAwesomeIcon icon={isModified ? byPrefixAndName.fas.check : byPrefixAndName.far.xmark} />
						</button>
					</nav>
				</div>
				<div className={styles.editorBlurLayer} aria-hidden="true" />
				<div
					className={styles.editorBlockLayer}
					aria-hidden="true"
					onPointerDown={handleInteractionGuardEvent}
					onPointerUp={handleInteractionGuardEvent}
					onMouseDown={handleInteractionGuardEvent}
					onMouseUp={handleInteractionGuardEvent}
					onTouchStart={handleInteractionGuardEvent}
					onTouchEnd={handleInteractionGuardEvent}
					onClick={handleInteractionGuardEvent}
				/>
			</section>

			<section
				className={`${styles.mediaSheet}${mediaDockOpen ? ` ${styles.mediaSheetOpen}` : ''}`}
				aria-label={t('editors.mediaDock')}
				onClick={(e) => e.stopPropagation()}
			>
				<button
					type="button"
					className={styles.mediaSheetHandle}
					onClick={() => {
						if (isMobileLandscapeRef.current) return;
						setMediaDockOpen((prev) => !prev);
					}}
					onTouchStart={handleTouchStart}
					onTouchMove={handleDockTouchMove}
					onTouchEnd={handleHandleTouchEnd}
					aria-label={t('editors.mediaDock')}
				>
					<span className={styles.mediaDockPill} aria-hidden="true" />
					<span className={styles.mediaDockLabel}>{t('editors.mediaTabMedia')}</span>
				</button>

				<header className={styles.mediaSheetHeader}>
					<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')} onTouchStart={handleTouchStart} onTouchEnd={handleDockSwipeEnd}>
						<button
							type="button"
							role="tab"
							aria-selected={mediaDockTab === 0}
							className={`${styles.mediaTab}${mediaDockTab === 0 ? ` ${styles.mediaTabActive}` : ''}`}
							onClick={() => setMediaDockTab(0)}
						>
							{t('editors.mediaTabMedia')}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={mediaDockTab === 1}
							className={`${styles.mediaTab}${mediaDockTab === 1 ? ` ${styles.mediaTabActive}` : ''}`}
							onClick={() => setMediaDockTab(1)}
						>
							{t('editors.mediaTabLinks')}
						</button>
					</div>
					<button type="button" className={styles.mediaSheetClose} onClick={() => setMediaDockOpen(false)} aria-label={t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.mediaSheetBody}>
					<div className={styles.mediaPanel} role="tabpanel">
						<div className={styles.mediaPanelPlaceholder} aria-hidden="true" />
					</div>
				</div>
			</section>

			<aside
				className={`${styles.mediaFlyout}${mediaDockOpen ? ` ${styles.mediaFlyoutOpen}` : ''}`}
				onClick={(e) => e.stopPropagation()}
				aria-hidden={!mediaDockOpen}
			>
					<header className={styles.mediaFlyoutHeader}>
						<div className={styles.mediaTabs} role="tablist" aria-label={t('editors.mediaDockTabs')}>
							<button
								type="button"
								role="tab"
								aria-selected={mediaDockTab === 0}
								className={`${styles.mediaTab}${mediaDockTab === 0 ? ` ${styles.mediaTabActive}` : ''}`}
								onClick={() => setMediaDockTab(0)}
							>
								{t('editors.mediaTabMedia')}
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={mediaDockTab === 1}
								className={`${styles.mediaTab}${mediaDockTab === 1 ? ` ${styles.mediaTabActive}` : ''}`}
								onClick={() => setMediaDockTab(1)}
							>
								{t('editors.mediaTabLinks')}
							</button>
						</div>
						<button type="button" className={styles.mediaFlyoutClose} onClick={() => setMediaDockOpen(false)} aria-label={t('common.close')}>
							✕
						</button>
					</header>
					<div className={styles.mediaFlyoutBody}>
						<div className={styles.mediaPanel} role="tabpanel">
							<div className={styles.mediaPanelPlaceholder} aria-hidden="true" />
						</div>
					</div>
			</aside>
		</div>
	);
}
