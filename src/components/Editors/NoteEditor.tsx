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
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	type CollisionDetection,
	type Modifier,
	type DragStartEvent as DndKitDragStartEvent,
	type DragMoveEvent as DndKitDragMoveEvent,
	type DragEndEvent as DndKitDragEndEvent,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	defaultAnimateLayoutChanges,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical } from '@fortawesome/free-solid-svg-icons';
import * as Y from 'yjs';
import { ChecklistBinding, HeadlessTextEditor, TextBinding, type ChecklistItem } from '../../core/bindings';
import { applyChecklistDragToItems, normalizeChecklistHierarchy, removeChecklistItemWithChildren } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import styles from './Editors.module.css';

export type NoteEditorProps = {
	noteId: string;
	doc: Y.Doc;
	onClose: () => void;
	onDelete: (noteId: string) => Promise<void>;
};

type NoteType = 'text' | 'checklist';

type TextBindingBundle = {
	ytext: Y.Text;
	editor: HeadlessTextEditor;
	binding: TextBinding;
};

const EMPTY_ITEMS: readonly ChecklistItem[] = [];
type MobileAxisLock = 'none' | 'vertical' | 'horizontal';

type MobileChecklistRowProps = {
	item: ChecklistItem;
	isChildHiddenWithParent: boolean;
	isDraggingParentChild: boolean;
	onToggleCompleted: (id: string, checked: boolean) => void;
	onTextChange: (id: string, text: string, textarea: HTMLTextAreaElement) => void;
	onTextInput: (textarea: HTMLTextAreaElement) => void;
	onTextKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>, id: string) => void;
	onRemove: (id: string) => void;
	setRowInputRef: (id: string, node: HTMLTextAreaElement | null) => void;
	setRowContainerRef: (id: string, node: HTMLLIElement | null) => void;
	removeLabel: string;
	dragHandleLabel: string;
	axisLock: MobileAxisLock;
};

function MobileChecklistRow(props: MobileChecklistRowProps): React.JSX.Element {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: props.item.id,
		animateLayoutChanges: (args) => defaultAnimateLayoutChanges(args),
		transition: {
			duration: 180,
			easing: 'cubic-bezier(0.2, 0, 0, 1)',
		},
	});
	const lockedTransform =
		isDragging && transform
			? props.axisLock === 'vertical'
				? { ...transform, x: 0 }
				: props.axisLock === 'horizontal'
					? { ...transform, x: 0, y: 0 }
					: transform
			: transform;

	return (
		<li
			ref={(node) => {
				setNodeRef(node);
				props.setRowContainerRef(props.item.id, node);
			}}
			className={`${styles.checklistItem}${props.item.parentId ? ` ${styles.childRow}` : ''}${isDragging || props.isDraggingParentChild ? ` ${styles.rowDragging}` : ''}${props.isChildHiddenWithParent ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
			aria-label={props.dragHandleLabel}
			style={{
				transform: CSS.Transform.toString(lockedTransform),
				transition: transition ?? 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
				zIndex: isDragging ? 80 : 1,
				opacity: isDragging && props.axisLock !== 'horizontal' ? 0 : 1,
				willChange: 'transform',
			}}
		>
			<button
				type="button"
				className={styles.dragHandle}
				aria-label={props.dragHandleLabel}
				title={props.dragHandleLabel}
				{...attributes}
				{...listeners}
			>
				<FontAwesomeIcon icon={faGripVertical} />
			</button>
			<input
				type="checkbox"
				className={styles.checklistCheckbox}
				checked={props.item.completed}
				onChange={(event) => props.onToggleCompleted(props.item.id, event.target.checked)}
			/>
			<textarea
				ref={(node) => props.setRowInputRef(props.item.id, node)}
				value={props.item.text}
				onChange={(event) => props.onTextChange(props.item.id, event.target.value, event.currentTarget)}
				onInput={(event) => props.onTextInput(event.currentTarget)}
				onKeyDown={(event) => props.onTextKeyDown(event, props.item.id)}
				className={styles.rowTextArea}
				rows={1}
			/>
			<button
				type="button"
				className={styles.rowRemoveButton}
				onClick={() => props.onRemove(props.item.id)}
				aria-label={props.removeLabel}
				title={props.removeLabel}
			>
				×
			</button>
		</li>
	);
}

function autoResizeTextarea(textarea: HTMLTextAreaElement | null): void {
	if (!textarea) return;
	textarea.style.height = '0px';
	textarea.style.height = `${Math.max(26, textarea.scrollHeight)}px`;
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
function useOptionalChecklistItems(binding: ChecklistBinding | null): readonly ChecklistItem[] {
	return useSyncExternalStore(
		(onStoreChange) => {
			if (!binding) return () => {};
			return binding.subscribe(onStoreChange);
		},
		() => binding?.getItems() ?? EMPTY_ITEMS,
		() => binding?.getItems() ?? EMPTY_ITEMS
	);
}

export function NoteEditor(props: NoteEditorProps): React.JSX.Element {
	const { t } = useI18n();
	const [isDeleting, setIsDeleting] = React.useState(false);
	const [showCompleted, setShowCompleted] = React.useState(false);
	const checklistArray = useMemo(() => props.doc.getArray<Y.Map<any>>('checklist'), [props.doc]);
	const rowInputsRef = React.useRef<Map<string, HTMLTextAreaElement | null>>(new Map());
	const rowContainersRef = React.useRef<Map<string, HTMLLIElement | null>>(new Map());
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; textHeight: number | null }>({ rowWidth: null, textHeight: null });
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const lastOverIndexRef = React.useRef<number | null>(null);
	const [draggingParentId, setDraggingParentId] = React.useState<string | null>(null);
	const [mobileActiveId, setMobileActiveId] = React.useState<string | null>(null);
	const [mobileAxisLock, setMobileAxisLock] = React.useState<MobileAxisLock>('none');
	const [isChecklistDragging, setIsChecklistDragging] = React.useState(false);
	const lastMobileCollisionTopRef = React.useRef<number | null>(null);
	const lastMobileCollisionDirectionRef = React.useRef<'up' | 'down'>('down');
	const lastMobileCollisionDirectionChangeTopRef = React.useRef<number | null>(null);
	const mobileDeltaRef = React.useRef({ x: 0, y: 0 });
	const mobileAxisLockRef = React.useRef<MobileAxisLock>('none');
	const mobileHorizontalDirectionRef = React.useRef<'left' | 'right' | null>(null);
	const isCoarsePointer = useIsCoarsePointer();
	const useMobileDndKit = isCoarsePointer;
	// metadata.type controls which editor body is rendered.
	const metadata = useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';

	const titleBundle = useMemo<TextBindingBundle>(() => {
		// HeadlessTextEditor + TextBinding keeps inputs synchronized with Yjs text.
		const ytext = props.doc.getText('title');
		const editor = new HeadlessTextEditor();
		const binding = new TextBinding({ ytext, editor, onUpdate: () => {} });
		return { ytext, editor, binding };
	}, [props.doc]);

	const contentBundle = useMemo<TextBindingBundle | null>(() => {
		// Only text notes expose a content field.
		if (type !== 'text') return null;
		const ytext = props.doc.getText('content');
		const editor = new HeadlessTextEditor();
		const binding = new TextBinding({ ytext, editor, onUpdate: () => {} });
		return { ytext, editor, binding };
	}, [props.doc, type]);

	const checklist = useMemo(() => {
		// Only checklist notes expose checklist items.
		if (type !== 'checklist') return null;
		return new ChecklistBinding({ yarray: props.doc.getArray<Y.Map<any>>('checklist'), onUpdate: () => {} });
	}, [props.doc, type]);

	React.useEffect(() => {
		return () => {
			titleBundle.binding.destroy();
			contentBundle?.binding.destroy();
			checklist?.destroy();
		};
	}, [titleBundle, contentBundle, checklist]);

	const title = useYTextValue(titleBundle.ytext);
	const content = useOptionalYTextValue(contentBundle?.ytext ?? null);
	const items = useOptionalChecklistItems(checklist);
	const normalizedItems = useMemo(() => normalizeChecklistHierarchy(items), [items]);
	const activeItems = useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedItems = useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);
	const mobileSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 6 },
		})
	);
	const mobileModifiers = React.useMemo<Modifier[]>(() => {
		if (mobileAxisLock === 'vertical') {
			return [({ transform }) => ({ ...transform, x: 0 })];
		}
		if (mobileAxisLock === 'horizontal') {
			return [({ transform }) => ({ ...transform, x: 0, y: 0 })];
		}
		return [];
	}, [mobileAxisLock]);

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

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent.
	// Refs are initialised with null and assigned on every render so the snap
	// handler callback always sees the latest values without re-registering.
	const normalizedItemsRef = React.useRef<readonly ChecklistItem[]>(normalizedItems);
	normalizedItemsRef.current = normalizedItems;
	const replaceChecklistItemsRef = React.useRef<((next: readonly ChecklistItem[]) => void) | null>(null);

	React.useEffect(() => {
		if (type !== 'checklist') return;
		return registerHorizontalSnapHandler((draggableId, direction) => {
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

		const suppressUntil = performance.now() + 220;
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
		}, 220);

		return () => {
			window.cancelAnimationFrame(rafIdA);
			window.cancelAnimationFrame(rafIdB);
			window.clearTimeout(timeoutId);
			document.removeEventListener('focusin', onFocusIn, true);
		};
	}, [props.noteId]);

	const addChecklistItem = React.useCallback(
		(index?: number): void => {
			if (!checklist) return;
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
		[checklist, checklistArray, items.length]
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
			if (!checklist) return;
			const childIds = new Set(normalizedItems.filter((item) => item.parentId === id).map((item) => item.id));
			for (const item of normalizedItems) {
				if (item.id === id || childIds.has(item.id)) {
					checklist.updateById(item.id, { completed: checked });
				}
			}
		},
		[checklist, normalizedItems]
	);

	const removeChecklistItem = React.useCallback(
		(id: string): void => {
			if (!checklist) return;
			const index = normalizedItems.findIndex((row) => row.id === id);
			const previousId = index > 0 ? normalizedItems[index - 1]?.id ?? null : null;
			const nextId = normalizedItems[index + 1]?.id ?? null;
			const nextItems = removeChecklistItemWithChildren(normalizedItems, id);
			replaceChecklistItems(nextItems);
			setFocusRowId(previousId ?? nextId);
		},
		[checklist, normalizedItems, replaceChecklistItems]
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
			dragGhostMetricsRef.current = { rowWidth: null, textHeight: null };
			resetChecklistDragAxis();
		},
		[normalizedItems, replaceChecklistItems]
	);

	const captureDragGhostMetrics = React.useCallback((id: string): void => {
		const rowNode = rowContainersRef.current.get(id);
		const textNode = rowInputsRef.current.get(id);
		const rowRect = rowNode?.getBoundingClientRect();
		dragGhostMetricsRef.current = {
			rowWidth: rowRect ? Math.ceil(rowRect.width) : null,
			textHeight: textNode ? Math.max(26, Math.ceil(textNode.scrollHeight) + 2) : null,
		};
	}, []);

	const vibrateIfAvailable = React.useCallback((ms: number): void => {
		if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
		navigator.vibrate(ms);
	}, []);

	const onChecklistDragStart = React.useCallback(
		(event: DragStart): void => {
			setIsChecklistDragging(true);
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
		[activeItems, captureDragGhostMetrics, vibrateIfAvailable]
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

	const clearMobileDragState = React.useCallback((): void => {
		setIsChecklistDragging(false);
		setMobileActiveId(null);
		setMobileAxisLock('none');
		mobileAxisLockRef.current = 'none';
		mobileDeltaRef.current = { x: 0, y: 0 };
		mobileHorizontalDirectionRef.current = null;
		setDraggingParentId(null);
		dragGhostMetricsRef.current = { rowWidth: null, textHeight: null };
		lastMobileCollisionTopRef.current = null;
		lastMobileCollisionDirectionRef.current = 'down';
		lastMobileCollisionDirectionChangeTopRef.current = null;
	}, []);

	const onMobileChecklistDragStart = React.useCallback(
		(event: DndKitDragStartEvent): void => {
			setIsChecklistDragging(true);
			lastMobileCollisionTopRef.current = null;
			lastMobileCollisionDirectionRef.current = 'down';
			lastMobileCollisionDirectionChangeTopRef.current = null;
			const draggableId = String(event.active.id);
			captureDragGhostMetrics(draggableId);
			setMobileActiveId(draggableId);
			setMobileAxisLock('none');
			mobileAxisLockRef.current = 'none';
			mobileDeltaRef.current = { x: 0, y: 0 };
			mobileHorizontalDirectionRef.current = null;
			const dragged = activeItems.find((item) => item.id === draggableId) ?? null;
			if (dragged && !dragged.parentId) {
				const hasChildren = activeItems.some((item) => item.parentId === dragged.id);
				setDraggingParentId(hasChildren ? dragged.id : null);
			} else {
				setDraggingParentId(null);
			}
			vibrateIfAvailable(12);
		},
		[activeItems, captureDragGhostMetrics, vibrateIfAvailable]
	);

	const mobileVariableHeightCollisionDetection = React.useCallback<CollisionDetection>(({ active, collisionRect, droppableContainers, droppableRects }) => {
		// Mobile variable-height checklist collision detection.
		//
		// Why we need this:
		// - `closestCenter` works nicely when all items are roughly the same height.
		// - With extreme multi-line items, the dragged item's center can be far away
		//   from where the user's finger/intent is, which causes "neighbour shift"
		//   decisions to happen at the wrong time.
		//
		// Behaviour we want (50% crossover semantics):
		// - When dragging UP: once the *top* of the dragged item crosses above the
		//   midpoint of the item above, that item should shift down.
		// - When dragging DOWN: once the *bottom* of the dragged item crosses below
		//   the midpoint of the item below, that item should shift up.
		//
		// Implementation strategy:
		// - Track "direction" (up/down) so we can use either top or bottom edge.
		// - Compare that reference edge against each item's midpoint.
		// - Return exactly one collision result: the item whose midpoint threshold
		//   has been crossed based on the current direction.
		if (!collisionRect) return [];

		const previousTop = lastMobileCollisionTopRef.current;
		if (typeof previousTop === 'number') {
			const dy = collisionRect.top - previousTop;
			// Direction changes during drag can cause chaos (the chosen edge switches
			// from top->bottom or bottom->top). To prevent "micro oscillations" when
			// the user jitters their finger, we require a minimum movement to flip
			// direction AND a minimum distance since the last flip.
			const directionThresholdPx = 6;
			const directionChangeHysteresisPx = 12;
			const lastChangeTop = lastMobileCollisionDirectionChangeTopRef.current;
			const distanceSinceChange = typeof lastChangeTop === 'number' ? Math.abs(collisionRect.top - lastChangeTop) : Number.POSITIVE_INFINITY;

			if (dy <= -directionThresholdPx && lastMobileCollisionDirectionRef.current !== 'up' && distanceSinceChange >= directionChangeHysteresisPx) {
				lastMobileCollisionDirectionRef.current = 'up';
				lastMobileCollisionDirectionChangeTopRef.current = collisionRect.top;
			} else if (dy >= directionThresholdPx && lastMobileCollisionDirectionRef.current !== 'down' && distanceSinceChange >= directionChangeHysteresisPx) {
				lastMobileCollisionDirectionRef.current = 'down';
				lastMobileCollisionDirectionChangeTopRef.current = collisionRect.top;
			}
		}
		lastMobileCollisionTopRef.current = collisionRect.top;

		const direction = lastMobileCollisionDirectionRef.current;
		// Use the edge that matches the intent:
		// - moving up -> compare the dragged TOP edge against neighbour midpoints
		// - moving down -> compare the dragged BOTTOM edge against neighbour midpoints
		const referenceY = direction === 'up' ? collisionRect.top : collisionRect.bottom;

		const entries: Array<{ id: string; midY: number }> = [];
		for (const container of droppableContainers) {
			if (String(container.id) === String(active.id)) continue;
			const rect = droppableRects.get(container.id);
			if (!rect) continue;
			entries.push({ id: String(container.id), midY: rect.top + rect.height / 2 });
		}

		entries.sort((a, b) => a.midY - b.midY);
		if (entries.length === 0) return [];

		// Use a 50% threshold relative to neighbours' midpoints.
		//
		// Subtle but important detail:
		// - When moving DOWN, we must NOT pick "the next item" as soon as we start
		//   approaching it. We only advance once the dragged BOTTOM has crossed that
		//   neighbour's midpoint. That means we pick the LAST midpoint we've crossed.
		// - When moving UP, we symmetrically pick the FIRST midpoint above the dragged
		//   TOP edge.
		let overId: string;
		if (direction === 'down') {
			overId = entries[0]!.id;
			for (const entry of entries) {
				if (entry.midY < referenceY) overId = entry.id;
				else break;
			}
		} else {
			overId = entries[entries.length - 1]!.id;
			for (const entry of entries) {
				if (entry.midY > referenceY) {
					overId = entry.id;
					break;
				}
			}
		}
		return [{ id: overId, data: { value: 0 } }];
	}, []);

	const onMobileChecklistDragMove = React.useCallback(
		(event: DndKitDragMoveEvent): void => {
			mobileDeltaRef.current = { x: event.delta.x, y: event.delta.y };
			if (mobileAxisLockRef.current === 'none') {
				const absX = Math.abs(event.delta.x);
				const absY = Math.abs(event.delta.y);
				if (absX >= 8 || absY >= 8) {
					const nextLock: MobileAxisLock = absX > absY * 1.1 ? 'horizontal' : 'vertical';
					mobileAxisLockRef.current = nextLock;
					if (nextLock === 'horizontal') {
						mobileHorizontalDirectionRef.current = event.delta.x >= 0 ? 'right' : 'left';
					}
					setMobileAxisLock(nextLock);
				}
			}
			const overId = event.over?.id ? String(event.over.id) : null;
			if (!overId) return;
			const nextIndex = activeItems.findIndex((item) => item.id === overId);
			if (nextIndex === -1 || lastOverIndexRef.current === nextIndex) return;
			lastOverIndexRef.current = nextIndex;
			if (mobileAxisLockRef.current !== 'horizontal') vibrateIfAvailable(6);
		},
		[activeItems, vibrateIfAvailable]
	);

	const onMobileChecklistDragEnd = React.useCallback(
		(event: DndKitDragEndEvent): void => {
			const activeId = String(event.active.id);
			const sourceIndex = activeItems.findIndex((item) => item.id === activeId);
			const overId = event.over?.id ? String(event.over.id) : null;
			const destinationIndex = overId ? activeItems.findIndex((item) => item.id === overId) : -1;

			const horizontalDirection = mobileHorizontalDirectionRef.current;
			const isHorizontal = mobileAxisLockRef.current === 'horizontal' && horizontalDirection !== null;

			if (sourceIndex !== -1) {
				if (isHorizontal) {
					const nextItems = applyChecklistDragToItems({
						items: normalizedItems,
						sourceIndex,
						destinationIndex: sourceIndex,
						axis: 'horizontal',
						horizontalDirection,
					});
					replaceChecklistItems(nextItems);
				} else if (destinationIndex !== -1) {
					const nextItems = applyChecklistDragToItems({
						items: normalizedItems,
						sourceIndex,
						destinationIndex,
						axis: 'vertical',
						horizontalDirection: null,
					});
					replaceChecklistItems(nextItems);
				}
			}

			lastOverIndexRef.current = null;
			clearMobileDragState();
		},
		[activeItems, clearMobileDragState, normalizedItems, replaceChecklistItems]
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

	const handleDelete = React.useCallback(async () => {
		// Prevent duplicate delete actions and keep button state explicit.
		if (isDeleting) return;
		setIsDeleting(true);
		try {
			await props.onDelete(props.noteId);
		} catch (error) {
			console.error('[CRDT] Failed to delete note:', props.noteId, error);
			setIsDeleting(false);
		}
	}, [isDeleting, props]);

	const renderChecklistClone = React.useCallback(
		(
			dragProvided: import('@hello-pangea/dnd').DraggableProvided,
			_snapshot: import('@hello-pangea/dnd').DraggableStateSnapshot,
			rubric: import('@hello-pangea/dnd').DraggableRubric
		): React.JSX.Element => {
			const dragged = activeItems.find((item) => item.id === rubric.draggableId) ?? null;
			const { rowWidth, textHeight } = dragGhostMetricsRef.current;

			return (
				<li
					ref={dragProvided.innerRef}
					{...dragProvided.draggableProps}
					className={`${styles.checklistItem} ${styles.rowDragging} ${styles.dragGhost}`}
					style={{ ...(dragProvided.draggableProps.style ?? {}), zIndex: 120, width: rowWidth ?? undefined, boxSizing: 'border-box' }}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					<textarea value={dragged?.text ?? ''} className={styles.rowTextArea} rows={1} style={{ height: textHeight ?? undefined }} readOnly />
				</li>
			);
		},
		[activeItems, t]
	);

	return (
		<div className={styles.fullscreenOverlay} role="presentation" onClick={props.onClose}>
			<section
				aria-label={`Editor ${props.noteId}`}
				className={`${styles.fullscreenEditor} ${styles.editorContainer}`}
				onClick={(event) => event.stopPropagation()}
			>
				<div className={styles.fullscreenHeader}>
					<div className={styles.editorMeta}>
						{t('editors.editing')}: {props.noteId}
					</div>
					<div className={styles.fullscreenActions}>
						<button type="button" onClick={handleDelete} disabled={isDeleting}>
							{isDeleting ? t('editors.deleting') : t('editors.delete')}
						</button>
						<button type="button" onClick={props.onClose} disabled={isDeleting}>
							{t('common.close')}
						</button>
					</div>
				</div>

				<label className={styles.field}>
					<span>{t('editors.title')}</span>
					<input
						value={title}
						onChange={(e) => setYTextValue(titleBundle.ytext, e.target.value)}
						placeholder={t('editors.untitled')}
					/>
				</label>

				{type === 'text' && contentBundle ? (
					<label className={`${styles.field} ${styles.fullBodyFieldContainer}`}>
						<span>{t('editors.content')}</span>
						<textarea
							value={content}
							onChange={(e) => setYTextValue(contentBundle.ytext, e.target.value)}
							rows={10}
							placeholder={t('editors.startTyping')}
							className={styles.fullBodyField}
						/>
					</label>
				) : null}

				{type === 'checklist' && checklist ? (
					<section aria-label="Checklist" className={`${styles.editorContainer} ${styles.checklistEditorSection}`}>
						<div className={styles.editorHeader}>
							<span>{t('editors.checklist')}</span>
							<button type="button" onClick={() => addChecklistItem()}>
								{t('editors.add')}
							</button>
						</div>

						<div className={styles.checklistScrollArea}>

						{useMobileDndKit ? (
							<DndContext
								sensors={mobileSensors}
								collisionDetection={mobileVariableHeightCollisionDetection}
								modifiers={mobileModifiers}
								onDragStart={onMobileChecklistDragStart}
								onDragMove={onMobileChecklistDragMove}
								onDragEnd={onMobileChecklistDragEnd}
								onDragCancel={() => {
									lastOverIndexRef.current = null;
									clearMobileDragState();
								}}
							>
								<SortableContext items={activeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
									<ul className={`${styles.checklistList}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}>
										{activeItems.map((item) => {
											const isParentChild = draggingParentId !== null && item.parentId === draggingParentId;
											return (
												<MobileChecklistRow
													key={item.id}
													item={item}
													isDraggingParentChild={isParentChild}
													isChildHiddenWithParent={isParentChild}
													onToggleCompleted={toggleChecklistCompleted}
													onTextChange={(id, text, textarea) => {
														checklist.updateById(id, { text });
														autoResizeTextarea(textarea);
													}}
													onTextInput={autoResizeTextarea}
													onTextKeyDown={onChecklistKeyDown}
													onRemove={removeChecklistItem}
													setRowInputRef={(id, node) => rowInputsRef.current.set(id, node)}
													setRowContainerRef={(id, node) => rowContainersRef.current.set(id, node)}
													removeLabel={t('editors.remove')}
													dragHandleLabel={t('editors.dragHandle')}
													axisLock={mobileAxisLock}
												/>
											);
										})}
									</ul>
								</SortableContext>
								<DragOverlay>
									{mobileActiveId && mobileAxisLock !== 'horizontal' ? (
										(() => {
											const dragged = activeItems.find((item) => item.id === mobileActiveId) ?? null;
											const { rowWidth, textHeight } = dragGhostMetricsRef.current;
											if (!dragged) return null;
											return (
												<li className={`${styles.checklistItem} ${styles.rowDragging} ${styles.dragGhost}`} style={{ zIndex: 120, width: rowWidth ?? undefined, boxSizing: 'border-box' }}>
													<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')}>
														<FontAwesomeIcon icon={faGripVertical} />
													</button>
													<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged.completed)} readOnly />
													<textarea value={dragged.text} className={styles.rowTextArea} rows={1} style={{ height: textHeight ?? undefined }} readOnly />
												</li>
											);
										})()
									) : null}
								</DragOverlay>
							</DndContext>
						) : (
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
																zIndex: snapshot.isDragging ? 80 : 1,
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
																	checklist.updateById(item.id, { text: event.target.value });
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
						)}

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
														checklist.updateById(item.id, { text: event.target.value });
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
			</section>
		</div>
	);
}
