import React from 'react';
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
	useSensor,
	useSensors,
} from '@dnd-kit/core';

// NOTE: We intentionally import this type from the concrete declaration file
// rather than `@dnd-kit/core`'s root re-export.
//
// In this repo's TS/Vite setup, the TS server occasionally resolves the root
// `CollisionDetection` symbol as a namespace/value instead of a type, which
// breaks `React.useCallback<CollisionDetection>(...)` typing and cascades into
// implicit-any destructuring errors. Importing from the leaf `.d.ts` avoids that
// ambiguity while keeping runtime output unchanged (type-only import).
import type { CollisionDetection as DndKitCollisionDetection } from '@dnd-kit/core/dist/utilities/algorithms/types';
import {
	SortableContext,
	defaultAnimateLayoutChanges,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical } from '@fortawesome/free-solid-svg-icons';
import type { ChecklistItem } from '../../core/bindings';
import { applyChecklistDragToItems, normalizeChecklistHierarchy, removeChecklistItemWithChildren } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useI18n } from '../../core/i18n';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import styles from './Editors.module.css';

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: ChecklistItem[] }) => void | Promise<void>;
	onCancel: () => void;
};

type DraftChecklistItem = ChecklistItem;
type MobileAxisLock = 'none' | 'vertical' | 'horizontal';
type DndKitDragStartArg = {
	active: { id: string | number };
};
type DndKitDragMoveArg = {
	delta: { x: number; y: number };
	over: { id: string | number } | null;
};
type DndKitDragEndArg = {
	active: { id: string | number };
	over: { id: string | number } | null;
};

function autoResizeTextarea(textarea: HTMLTextAreaElement | null): void {
	if (!textarea) return;
	textarea.style.height = '0px';
	textarea.style.height = `${Math.max(26, textarea.scrollHeight)}px`;
}

// Local-only draft ID generator used before data is persisted to Yjs.
function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MobileChecklistRowProps = {
	item: DraftChecklistItem;
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
	placeholder: string;
	axisLock: MobileAxisLock;
};

function MobileChecklistRow(props: MobileChecklistRowProps): React.JSX.Element {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: props.item.id,
		animateLayoutChanges: (args: Parameters<typeof defaultAnimateLayoutChanges>[0]) => defaultAnimateLayoutChanges(args),
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
			className={`${styles.checklistComposerRow}${props.item.parentId ? ` ${styles.childRow}` : ''}${isDragging || props.isDraggingParentChild ? ` ${styles.rowDragging}` : ''}${props.isChildHiddenWithParent ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
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
				placeholder={props.placeholder}
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

export function ChecklistEditor(props: ChecklistEditorProps): React.JSX.Element {
	const { t } = useI18n();
	// Local draft state until user presses Save.
	const [title, setTitle] = React.useState('');
	const [items, setItems] = React.useState<DraftChecklistItem[]>(() => [
		{ id: makeId(), text: '', completed: false, parentId: null },
	]);
	const [saving, setSaving] = React.useState(false);
	const [showCompleted, setShowCompleted] = React.useState(false);
	const titleInputRef = React.useRef<HTMLInputElement | null>(null);
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

	const normalizedItems = React.useMemo(() => normalizeChecklistHierarchy(items), [items]);
	const activeItems = React.useMemo(() => normalizedItems.filter((row) => !row.completed), [normalizedItems]);
	const completedItems = React.useMemo(() => normalizedItems.filter((row) => row.completed), [normalizedItems]);
	const mobileSensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 6 },
		})
	);
	const mobileModifiers = React.useMemo(() => {
		if (mobileAxisLock === 'vertical') {
			return [({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({ ...transform, x: 0 })];
		}
		if (mobileAxisLock === 'horizontal') {
			return [({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({ ...transform, x: 0, y: 0 })];
		}
		return [];
	}, [mobileAxisLock]);

	React.useEffect(() => {
		if (!focusRowId) return;
		const target = rowInputsRef.current.get(focusRowId) ?? null;
		autoResizeTextarea(target);
		target?.focus();
		setFocusRowId(null);
	}, [focusRowId, items]);

	React.useLayoutEffect(() => {
		for (const textarea of rowInputsRef.current.values()) {
			autoResizeTextarea(textarea);
		}
	}, [items, showCompleted]);

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, []);

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent.
	React.useEffect(() => {
		return registerHorizontalSnapHandler((draggableId, direction) => {
			setItems((prev) => {
				const normalized = normalizeChecklistHierarchy(prev);
				const active = normalized.filter((item) => !item.completed);
				const sourceIndex = active.findIndex((item) => item.id === draggableId);
				if (sourceIndex === -1) return prev;
				return applyChecklistDragToItems({
					items: normalized,
					sourceIndex,
					destinationIndex: sourceIndex,
					axis: 'horizontal',
					horizontalDirection: direction,
				});
			});
		});
	}, []);

	const addItem = React.useCallback((index?: number): void => {
		const nextId = makeId();
		setItems((prev) => {
			const next = prev.slice();
			const insertAt = typeof index === 'number' ? Math.max(0, Math.min(prev.length, index + 1)) : prev.length;
			next.splice(insertAt, 0, { id: nextId, text: '', completed: false, parentId: null });
			return next;
		});
		setFocusRowId(nextId);
	}, []);

	const updateItem = React.useCallback((id: string, patch: Partial<DraftChecklistItem>): void => {
		setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
	}, []);

	const toggleCompleted = React.useCallback((id: string, checked: boolean): void => {
		setItems((prev) => {
			const normalized = normalizeChecklistHierarchy(prev);
			const childIds = new Set(
				normalized.filter((item) => item.parentId === id).map((item) => item.id)
			);
			return normalized.map((item) => {
				if (item.id === id || childIds.has(item.id)) {
					return { ...item, completed: checked };
				}
				return item;
			});
		});
	}, []);

	const removeItem = React.useCallback((id: string): void => {
		setItems((prev) => removeChecklistItemWithChildren(prev, id));
	}, []);

	const onDragEnd = React.useCallback((event: DropResult): void => {
		const destination = event.destination;
		if (!destination) return;
		const axis = getChecklistDragAxis() ?? 'vertical';
		const horizontalDirection = getChecklistHorizontalDirection();
		setItems((prev) =>
			applyChecklistDragToItems({
				items: prev,
				sourceIndex: event.source.index,
				destinationIndex: destination.index,
				axis,
				horizontalDirection,
			})
		);
		setDraggingParentId(null);
		dragGhostMetricsRef.current = { rowWidth: null, textHeight: null };
		resetChecklistDragAxis();
	}, []);

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

	const onDragStart = React.useCallback(
		(event: DragStart): void => {
			setIsChecklistDragging(true);
			// Desktop ghost sizing notes:
			// - Measuring after drag start can be misleading because the library may
			//   apply inline styles / transforms that change the element's computed
			//   box. That is what caused the "narrow ghost" regressions.
			// - We prefer metrics captured in `onBeforeCapture` (stable DOM) and only
			//   fall back to measuring here if refs weren't ready.
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

	const onBeforeCapture = React.useCallback(
		(before: BeforeCapture): void => {
			// Capture the dragged row's size *before* the drag starts so the clone
			// exactly matches the row's width/height.
			captureDragGhostMetrics(before.draggableId);
		},
		[captureDragGhostMetrics]
	);

	const onDragUpdate = React.useCallback(
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

	const onMobileDragStart = React.useCallback(
		(event: DndKitDragStartArg): void => {
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

	const mobileVariableHeightCollisionDetection = React.useCallback<DndKitCollisionDetection>(({ active, collisionRect, droppableContainers, droppableRects }) => {
		// Mobile variable-height checklist collision detection.
		//
		// Why we need this:
		// - `closestCenter` works well when items are similar heights.
		// - If the dragged item is extremely tall (multi-line textarea), its center
		//   can be nowhere near the user's finger, causing reordering to trigger too
		//   early/late.
		//
		// Desired behaviour (50% crossover semantics):
		// - Drag UP: when the dragged TOP edge crosses above a neighbour's midpoint,
		//   that neighbour should shift down.
		// - Drag DOWN: when the dragged BOTTOM edge crosses below a neighbour's midpoint,
		//   that neighbour should shift up.
		//
		// We implement this by:
		// - Tracking direction (up/down) with hysteresis.
		// - Comparing the appropriate edge (top/bottom) to each item's midpoint.
		// - Returning a single `over` id representing the current threshold crossing.
		if (!collisionRect) return [];

		const previousTop = lastMobileCollisionTopRef.current;
		if (typeof previousTop === 'number') {
			const dy = collisionRect.top - previousTop;
			// Direction flipping is dangerous here because it switches our reference
			// point from TOP edge to BOTTOM edge (or vice versa), which can produce
			// "chaos" if the user jitters their finger.
			//
			// These two thresholds make direction changes stable:
			// - `directionThresholdPx`: minimum movement to consider flipping
			// - `directionChangeHysteresisPx`: minimum travel since last flip
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
		// Use the edge that matches the user's intent:
		// - moving up -> compare dragged TOP edge
		// - moving down -> compare dragged BOTTOM edge
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

		let overId: string;
		if (direction === 'down') {
			// DOWN: pick the LAST midpoint we've crossed (prevents early shifting).
			overId = entries[0]!.id;
			for (const entry of entries) {
				if (entry.midY < referenceY) overId = entry.id;
				else break;
			}
		} else {
			// UP: pick the FIRST midpoint above the dragged TOP edge.
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

	const onMobileDragMove = React.useCallback(
		(event: DndKitDragMoveArg): void => {
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

	const onMobileDragEnd = React.useCallback(
		(event: DndKitDragEndArg): void => {
			const activeId = String(event.active.id);
			const sourceIndex = activeItems.findIndex((item) => item.id === activeId);
			const overId = event.over?.id ? String(event.over.id) : null;
			const destinationIndex = overId ? activeItems.findIndex((item) => item.id === overId) : -1;

			const horizontalDirection = mobileHorizontalDirectionRef.current;
			const isHorizontal = mobileAxisLockRef.current === 'horizontal' && horizontalDirection !== null;

			if (sourceIndex !== -1) {
				if (isHorizontal) {
					setItems((prev) =>
						applyChecklistDragToItems({
							items: prev,
							sourceIndex,
							destinationIndex: sourceIndex,
							axis: 'horizontal',
							horizontalDirection,
						})
					);
				} else if (destinationIndex !== -1) {
					setItems((prev) =>
						applyChecklistDragToItems({
							items: prev,
							sourceIndex,
							destinationIndex,
							axis: 'vertical',
							horizontalDirection: null,
						})
					);
				}
			}

			lastOverIndexRef.current = null;
			clearMobileDragState();
		},
		[activeItems, clearMobileDragState]
	);

	const onRowKeyDown = React.useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>, rowId: string): void => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				const currentIndex = normalizedItems.findIndex((row) => row.id === rowId);
				addItem(currentIndex);
				return;
			}

			if (event.key === 'Backspace') {
				const current = normalizedItems.find((row) => row.id === rowId);
				if (!current || current.text.length > 0) return;
				event.preventDefault();
				const currentIndex = normalizedItems.findIndex((row) => row.id === rowId);
				const previousId = currentIndex > 0 ? normalizedItems[currentIndex - 1]?.id ?? null : null;
				const nextId = normalizedItems[currentIndex + 1]?.id ?? null;
				removeItem(rowId);
				setFocusRowId(previousId ?? nextId);
			}
		},
		[addItem, normalizedItems, removeItem]
	);

	const onSubmit = async (event: React.FormEvent): Promise<void> => {
		// Submission delegates persistence to parent App handlers.
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			await props.onSave({ title, items });
		} finally {
			setSaving(false);
		}
	};

	const removeItemAndFocus = React.useCallback(
		(id: string): void => {
			const currentIndex = normalizedItems.findIndex((row) => row.id === id);
			const previousId = currentIndex > 0 ? normalizedItems[currentIndex - 1]?.id ?? null : null;
			const nextId = normalizedItems[currentIndex + 1]?.id ?? null;
			removeItem(id);
			setFocusRowId(previousId ?? nextId);
		},
		[normalizedItems, removeItem]
	);

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
					className={`${styles.checklistComposerRow} ${styles.rowDragging} ${styles.dragGhost}`}
					style={{
						...(dragProvided.draggableProps.style ?? {}),
						zIndex: 120,
						width: rowWidth ?? undefined,
						boxSizing: 'border-box',
					}}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					<textarea
						value={dragged?.text ?? ''}
						className={styles.rowTextArea}
						rows={1}
						style={{ height: textHeight ?? undefined, minHeight: textHeight ?? undefined, minWidth: 0, flex: '1 1 auto' }}
						readOnly
					/>
				</li>
			);
		},
		[activeItems, t]
	);

	return (
		<div className={styles.fullscreenOverlay} role="presentation" onClick={props.onCancel}>
			<form onSubmit={onSubmit} className={styles.fullscreenEditor} onClick={(event) => event.stopPropagation()}>
				<header className={styles.fullscreenHeader}>
					<h2 className={styles.fullscreenTitle}>{t('editors.newChecklist')}</h2>
					<div className={styles.fullscreenActions}>
						<button type="button" onClick={() => addItem()} disabled={saving}>
							{t('editors.addItem')}
						</button>
						<button type="submit" disabled={saving}>
							{saving ? t('editors.saving') : t('common.save')}
						</button>
						<button type="button" onClick={props.onCancel} disabled={saving}>
							{t('common.cancel')}
						</button>
					</div>
				</header>

				<input
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>
				<div className={styles.checklistHint}>{t('editors.checklistHint')}</div>

				<div className={styles.checklistScrollArea}>

				{useMobileDndKit ? (
					<DndContext
						sensors={mobileSensors}
						collisionDetection={mobileVariableHeightCollisionDetection}
						modifiers={mobileModifiers}
						onDragStart={onMobileDragStart}
						onDragMove={onMobileDragMove}
						onDragEnd={onMobileDragEnd}
						onDragCancel={() => {
							lastOverIndexRef.current = null;
							clearMobileDragState();
						}}
					>
						<SortableContext items={activeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
							<ul className={`${styles.checklistComposer}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}>
								{activeItems.map((item) => {
									const isParentChild = draggingParentId !== null && item.parentId === draggingParentId;
									return (
										<MobileChecklistRow
											key={item.id}
											item={item}
											isDraggingParentChild={isParentChild}
											isChildHiddenWithParent={isParentChild}
											onToggleCompleted={toggleCompleted}
											onTextChange={(id, text, textarea) => {
												updateItem(id, { text });
												autoResizeTextarea(textarea);
											}}
											onTextInput={autoResizeTextarea}
											onTextKeyDown={onRowKeyDown}
											onRemove={removeItemAndFocus}
											setRowInputRef={(id, node) => {
												rowInputsRef.current.set(id, node);
											}}
											setRowContainerRef={(id, node) => {
												rowContainersRef.current.set(id, node);
											}}
											removeLabel={t('editors.remove')}
											dragHandleLabel={t('editors.dragHandle')}
											placeholder={t('editors.checklistItemPlaceholder')}
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
										<li className={`${styles.checklistComposerRow} ${styles.rowDragging} ${styles.dragGhost}`} style={{ zIndex: 120, width: rowWidth ?? undefined, boxSizing: 'border-box' }}>
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
						onBeforeCapture={onBeforeCapture}
						onDragStart={onDragStart}
						onDragUpdate={onDragUpdate}
						onDragEnd={(event) => {
							lastOverIndexRef.current = null;
							onDragEnd(event);
							setIsChecklistDragging(false);
							setDraggingParentId(null);
							resetChecklistDragAxis();
						}}
					>
						<Droppable droppableId="checklist-active-items" renderClone={renderChecklistClone}>
							{(dropProvided) => (
								<ul
									className={`${styles.checklistComposer}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}
									ref={dropProvided.innerRef}
									{...dropProvided.droppableProps}
								>
									{activeItems.map((item, index) => (
										<Draggable key={item.id} draggableId={item.id} index={index} disableInteractiveElementBlocking>
											{(dragProvided, snapshot) => (
												<li
																ref={(node) => {
																	dragProvided.innerRef(node);
																	rowContainersRef.current.set(item.id, node);
																}}
													{...dragProvided.draggableProps}
													className={`${styles.checklistComposerRow}${item.parentId ? ` ${styles.childRow}` : ''}${snapshot.isDragging || (draggingParentId !== null && item.parentId === draggingParentId) ? ` ${styles.rowDragging}` : ''}${draggingParentId !== null && item.parentId === draggingParentId ? ` ${styles.childDraggingWithParent} ${styles.childHiddenDuringParentDrag}` : ''}`}
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
														onChange={(event) => toggleCompleted(item.id, event.target.checked)}
													/>
													<textarea
														ref={(node) => {
															rowInputsRef.current.set(item.id, node);
														}}
														value={item.text}
														onChange={(event) => {
															updateItem(item.id, { text: event.target.value });
															autoResizeTextarea(event.currentTarget);
														}}
														onInput={(event) => autoResizeTextarea(event.currentTarget)}
														onKeyDown={(event) => onRowKeyDown(event, item.id)}
														placeholder={t('editors.checklistItemPlaceholder')}
														className={styles.rowTextArea}
														rows={1}
													/>
													<button
														type="button"
														className={styles.rowRemoveButton}
														onClick={() => removeItemAndFocus(item.id)}
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
							<ul className={`${styles.checklistComposer}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}>
								{completedItems.map((item) => (
									<li key={item.id} className={`${styles.checklistComposerRow}${item.parentId ? ` ${styles.childRow}` : ''}`}>
										<div className={styles.dragHandle} aria-hidden="true">
													<FontAwesomeIcon icon={faGripVertical} />
										</div>
										<input
											type="checkbox"
											className={styles.checklistCheckbox}
											checked={item.completed}
											onChange={(event) => toggleCompleted(item.id, event.target.checked)}
										/>
										<textarea
												ref={(node) => {
													rowInputsRef.current.set(item.id, node);
												}}
											value={item.text}
											onChange={(event) => {
												updateItem(item.id, { text: event.target.value });
												autoResizeTextarea(event.currentTarget);
											}}
											onInput={(event) => autoResizeTextarea(event.currentTarget)}
											className={styles.rowTextArea}
											rows={1}
										/>
										<button
											type="button"
											className={styles.rowRemoveButton}
											onClick={() => removeItem(item.id)}
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
			</form>
		</div>
	);
}
