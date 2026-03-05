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
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGripVertical } from '@fortawesome/free-solid-svg-icons';
import type { ChecklistItem } from '../../core/bindings';
import { applyChecklistDragToItems, normalizeChecklistHierarchy, removeChecklistItemWithChildren } from '../../core/checklistHierarchy';
import { getChecklistDragAxis, getChecklistHorizontalDirection, registerHorizontalSnapHandler, resetChecklistDragAxis } from '../../core/checklistDragState';
import { immediateChecklistSensors } from '../../core/dndSensors';
import { useChecklistFlip } from '../../core/useChecklistFlip';
import { useI18n } from '../../core/i18n';
import styles from './Editors.module.css';

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: ChecklistItem[] }) => void | Promise<void>;
	onCancel: () => void;
};

type DraftChecklistItem = ChecklistItem;

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
	// Drag “ghost” sizing:
	// - We capture metrics from the real row *before* the drag starts.
	// - Height alone is not enough for multiline items: if the clone’s text area
	//   ends up with even a slightly different width, the text re-wraps, which
	//   looks like the ghost “changes” and can pull words from neighbouring lines.
	// - Capturing the text area's exact width lets the clone reflow identically.
	const dragGhostMetricsRef = React.useRef<{ rowWidth: number | null; textHeight: number | null; textWidth: number | null }>({ rowWidth: null, textHeight: null, textWidth: null });
	const [focusRowId, setFocusRowId] = React.useState<string | null>(null);
	const lastOverIndexRef = React.useRef<number | null>(null);
	const [draggingParentId, setDraggingParentId] = React.useState<string | null>(null);
	const [isChecklistDragging, setIsChecklistDragging] = React.useState(false);

	// FLIP animation helper for indent/un-indent (horizontal snap):
	// We snapshot row positions immediately before we mutate the list so React's
	// next render can animate rows from old -> new positions (less “teleporting”).
	const { capturePositions: captureFlipPositions } = useChecklistFlip(rowContainersRef, items);

	const normalizedItems = React.useMemo(() => normalizeChecklistHierarchy(items), [items]);
	const activeItems = React.useMemo(() => normalizedItems.filter((row) => !row.completed), [normalizedItems]);
	const completedItems = React.useMemo(() => normalizedItems.filter((row) => row.completed), [normalizedItems]);

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

	// Textareas are auto-resized based on scrollHeight, but scrollHeight changes
	// when the available width changes (wrapping adds/removes lines).
	// Without this, resizing the desktop window can cause visible clipping.
	//
	// We use rAF-debouncing to avoid doing layout work on every resize event.
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

	React.useEffect(() => {
		const rafId = window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
		});
		return () => window.cancelAnimationFrame(rafId);
	}, []);

	// Horizontal snap handler — bypass the drag library entirely for indent/unindent.
	// Important: we capture FLIP positions *before* the setItems() call so the
	// subsequent re-render can animate the moved row(s) into place.
	React.useEffect(() => {
		return registerHorizontalSnapHandler((draggableId, direction) => {
			captureFlipPositions();
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
		dragGhostMetricsRef.current = { rowWidth: null, textHeight: null, textWidth: null };
		resetChecklistDragAxis();
	}, []);

	// Measure the row + text element before dragging so the drag clone matches
	// the original exactly (especially critical for multiline wrapping).
	const captureDragGhostMetrics = React.useCallback((id: string): void => {
		const rowNode = rowContainersRef.current.get(id);
		const textNode = rowInputsRef.current.get(id);
		const rowRect = rowNode?.getBoundingClientRect();
		const textRect = textNode?.getBoundingClientRect();
		dragGhostMetricsRef.current = {
			rowWidth: rowRect ? Math.ceil(rowRect.width) : null,
			textHeight: textNode ? Math.max(26, Math.ceil(textNode.scrollHeight) + 2) : null,
			textWidth: textRect ? Math.ceil(textRect.width) : null,
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
			const { rowWidth, textHeight, textWidth } = dragGhostMetricsRef.current;

			return (
				<li
					ref={dragProvided.innerRef}
					{...dragProvided.draggableProps}
					className={`${styles.checklistComposerRow} ${styles.rowDragging} ${styles.dragGhost}`}
					style={{
						...(dragProvided.draggableProps.style ?? {}),
						width: rowWidth ?? undefined,
						boxSizing: 'border-box',
					}}
				>
					<button type="button" className={styles.dragHandle} aria-label={t('editors.dragHandle')} {...dragProvided.dragHandleProps}>
						<FontAwesomeIcon icon={faGripVertical} />
					</button>
					<input type="checkbox" className={styles.checklistCheckbox} checked={Boolean(dragged?.completed)} readOnly />
					{/*
						Clone sizing:
						- Fixing the clone's textarea width prevents re-wrapping relative to
						  the original row (which otherwise causes the “ghost is larger” effect).
						- We also fix the height so the clone doesn't shrink/expand mid-drag.
					*/}
					<textarea
						value={dragged?.text ?? ''}
						className={styles.rowTextArea}
						rows={1}
						style={{ height: textHeight ?? undefined, minHeight: textHeight ?? undefined, width: textWidth ?? undefined, minWidth: 0, flex: '0 0 auto' }}
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
