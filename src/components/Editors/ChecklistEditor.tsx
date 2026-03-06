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
import {
	faBell,
	faBold,
	faImage,
	faEllipsisVertical,
	faGripVertical,
	faItalic,
	faLink,
	faPalette,
	faUnderline,
	faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
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

export type ChecklistEditorProps = {
	onSave: (args: { title: string; items: ChecklistItem[] }) => void | Promise<void>;
	onCancel: () => void;
};

type DraftChecklistItem = ChecklistItem;

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
	const [mediaDockOpen, setMediaDockOpen] = React.useState(false);
	const [mediaDockTab, setMediaDockTab] = React.useState<0 | 1>(0);
	const [interactionGuardActive, setInteractionGuardActive] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const isMobileLandscape = useIsMobileLandscape();
	const isMobileLandscapeRef = React.useRef(isMobileLandscape);
	React.useEffect(() => {
		isMobileLandscapeRef.current = isMobileLandscape;
		// Landscape branch: keep media dock closed and prevent opening gestures.
		if (isMobileLandscape) setMediaDockOpen(false);
	}, [isMobileLandscape]);
	React.useEffect(() => {
		// Coarse-pointer branch: shield initial interactions to absorb delayed
		// tap/mouse compatibility events from the opener surface.
		if (!isCoarsePointer || typeof window === 'undefined') return;
		setInteractionGuardActive(true);
		const timeoutId = window.setTimeout(() => setInteractionGuardActive(false), 420);
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
	const handleHandleTouchEnd = React.useCallback((event: React.TouchEvent): void => {
		// Landscape branch: dock open/close gestures are blocked.
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
	}, []);
	const handleDockSwipeEnd = React.useCallback((event: React.TouchEvent): void => {
		// Landscape branch: media tab swipe is blocked with dock locked closed.
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
	}, []);
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
		setItems((prev) => {
			const normalized = normalizeChecklistHierarchy(prev);
			if (normalized.length <= 1) return prev;
			const firstActiveId = normalized.find((row) => !row.completed)?.id ?? normalized[0]?.id ?? null;
			if (firstActiveId && id === firstActiveId) return prev;
			return removeChecklistItemWithChildren(prev, id);
		});
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
				if (activeItems[0]?.id === rowId) {
					event.preventDefault();
					return;
				}
				event.preventDefault();
				const currentIndex = normalizedItems.findIndex((row) => row.id === rowId);
				const previousId = currentIndex > 0 ? normalizedItems[currentIndex - 1]?.id ?? null : null;
				const nextId = normalizedItems[currentIndex + 1]?.id ?? null;
				removeItem(rowId);
				setFocusRowId(previousId ?? nextId);
			}
		},
		[activeItems, addItem, normalizedItems, removeItem]
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
			if (activeItems[0]?.id === id) return;
			const currentIndex = normalizedItems.findIndex((row) => row.id === id);
			const previousId = currentIndex > 0 ? normalizedItems[currentIndex - 1]?.id ?? null : null;
			const nextId = normalizedItems[currentIndex + 1]?.id ?? null;
			removeItem(id);
			setFocusRowId(previousId ?? nextId);
		},
		[activeItems, normalizedItems, removeItem]
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
					<div className={styles.dragPreviewText} style={{ height: textHeight ?? undefined, width: textWidth ?? undefined, flex: '0 0 auto' }}>
						{dragged?.text ?? ''}
					</div>
				</li>
			);
		},
		[activeItems, t]
	);

	return (
		<div className={styles.fullscreenOverlay} role="presentation" onClick={mediaDockOpen ? undefined : props.onCancel}>
			<form
				onSubmit={onSubmit}
				className={`${styles.fullscreenEditor} ${styles.editorContainer} ${styles.editorBlurred}${mediaDockOpen ? ` ${styles.mediaOpen}` : ''}${interactionGuardActive ? ` ${styles.editorInteractionGuardActive}` : ''}`}
				onClick={(event) => event.stopPropagation()}
			>
				<input
					className={styles.editorTitleInput}
					ref={titleInputRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder={t('editors.titlePlaceholder')}
				/>

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
										className={`${styles.checklistList}${isChecklistDragging ? ` ${styles.listDragging}` : ''}`}
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
				</section>

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

					<nav className={`${styles.bottomDock} ${styles.bottomDockCompact}`} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faPalette} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
							<button type="button" className={`${styles.bottomDockButton} ${styles.bottomDockButtonCompact}`} aria-label={t('editors.dockAction')} disabled>
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
						<div className={styles.bottomDockRightActions}>
							<button
								type="button"
								className={styles.bottomDockClose}
								onClick={props.onCancel}
								disabled={saving}
								aria-label={t('common.cancel')}
								title={t('common.cancel')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas.ban} />
							</button>
							<button
								type="submit"
								className={styles.bottomDockClose}
								disabled={saving}
								aria-label={saving ? t('editors.saving') : t('common.save')}
								title={saving ? t('editors.saving') : t('common.save')}
							>
								<FontAwesomeIcon icon={byPrefixAndName.fas['floppy-disk']} />
							</button>
						</div>
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
			</form>

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
					<button
						type="button"
						className={styles.mediaSheetClose}
						onClick={() => {
							if (isMobileLandscapeRef.current) return;
							setMediaDockOpen(false);
						}}
						aria-label={t('common.close')}
					>
						✕
					</button>
				</header>

				<div className={styles.mediaSheetBody}>
					<div className={styles.mediaPanel} role="tabpanel">
						<div className={styles.mediaPanelPlaceholder} aria-hidden="true" />
					</div>
				</div>
			</section>
		</div>
	);
}
