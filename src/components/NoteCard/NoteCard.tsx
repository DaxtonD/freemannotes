import React from 'react';
import * as Y from 'yjs';
import type { ChecklistItem } from '../../core/bindings';
import { normalizeChecklistHierarchy } from '../../core/checklistHierarchy';
import { getDeviceId } from '../../core/deviceId';
import { useI18n } from '../../core/i18n';
import {
	getNoteCardCompletedExpanded,
	setNoteCardCompletedExpanded,
} from '../../core/noteCardCompletedExpansion';
import { updateUserPreferences } from '../../core/userDevicePreferencesApi';
import styles from './NoteCard.module.css';

export type NoteCardProps = {
	noteId: string;
	doc: Y.Doc;
	hasPendingSync?: boolean;
	onOpen?: () => void;
	onMoreMenu?: () => void;
	shouldSuppressOpen?: () => boolean;
	dragHandleRef?: (node: HTMLDivElement | null) => void;
	dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
	maxCardHeightPx?: number;
};

type NoteType = 'text' | 'checklist';

function isInteractiveTarget(target: EventTarget | null): boolean {
	if (!target || !(target instanceof HTMLElement)) return false;
	return Boolean(target.closest('input, button, textarea, select, a, [role="textbox"]'));
}

function isCoarsePointerDevice(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(pointer: coarse)').matches;
}

function suppressNextDocumentCompatibilityMouseEvents(): void {
	// Mobile browsers often dispatch compatibility mouse events after touch:
	// `mousedown` -> `mouseup` -> `click`.
	// If we open the editor overlay on pointer-up, those can land on the newly
	// mounted editor ("click-through"), selecting text/focusing controls.
	//
	// Suppress these events briefly, in capture phase.
	if (typeof window === 'undefined') return;
	let timeoutId = 0;
	const handler = (event: MouseEvent): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	const cleanup = (): void => {
		window.removeEventListener('mousedown', handler, true);
		window.removeEventListener('mouseup', handler, true);
		window.removeEventListener('click', handler, true);
		if (timeoutId) window.clearTimeout(timeoutId);
	};
	window.addEventListener('mousedown', handler, true);
	window.addEventListener('mouseup', handler, true);
	window.addEventListener('click', handler, true);
	// Cleanup shortly after the synthetic sequence would fire.
	timeoutId = window.setTimeout(() => cleanup(), 500);
}

// Subscribe to an optional Y.Text and always return a string snapshot.
function useOptionalYTextValue(getYText: () => Y.Text | null): string {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const ytext = getYText();
			if (!ytext) return () => {};
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => getYText()?.toString() ?? '',
		() => getYText()?.toString() ?? ''
	);
}

// Read a metadata field from Y.Map with live updates.
function useMetadataString(metadata: Y.Map<any>, key: string): string {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			metadata.observe(observer);
			return () => metadata.unobserve(observer);
		},
		() => String(metadata.get(key) ?? ''),
		() => String(metadata.get(key) ?? '')
	);
}

// Subscribe to checklist binding updates from Y.Array.
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

function useChecklistItems(yarray: Y.Array<Y.Map<any>>): readonly ChecklistItem[] {
	const cacheRef = React.useRef<{
		yarray: Y.Array<Y.Map<any>>;
		items: readonly ChecklistItem[];
	} | null>(null);

	return React.useSyncExternalStore(
		(onStoreChange) => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			const observer = (): void => {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
				onStoreChange();
			};
			yarray.observeDeep(observer);
			return () => yarray.unobserveDeep(observer);
		},
		() => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		},
		() => {
			if (!cacheRef.current || cacheRef.current.yarray !== yarray) {
				cacheRef.current = { yarray, items: materializeChecklistItems(yarray) };
			}
			return cacheRef.current.items;
		}
	);
}

export function NoteCard(props: NoteCardProps): React.JSX.Element {
	const { t } = useI18n();
	// metadata.type controls note rendering mode.
	const metadata = React.useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';

	const title = useOptionalYTextValue(React.useCallback(() => props.doc.getText('title'), [props.doc]));
	const content = useOptionalYTextValue(
		React.useCallback(() => (type === 'text' ? props.doc.getText('content') : null), [props.doc, type])
	);
	const checklistArray = React.useMemo(() => props.doc.getArray<Y.Map<any>>('checklist'), [props.doc]);
	const checklistItems = useChecklistItems(checklistArray);
	const normalizedItems = React.useMemo(() => normalizeChecklistHierarchy(checklistItems), [checklistItems]);
	const [showCompleted, setShowCompleted] = React.useState<boolean>(() => getNoteCardCompletedExpanded(props.noteId));
	const [multilineById, setMultilineById] = React.useState<Record<string, boolean>>({});
	const cardRef = React.useRef<HTMLElement | null>(null);

	React.useEffect(() => {
		setShowCompleted(getNoteCardCompletedExpanded(props.noteId));
	}, [props.noteId]);
	const activeChecklistItems = React.useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedChecklistItems = React.useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);

	React.useLayoutEffect(() => {
		if (type !== 'checklist') return;
		const card = cardRef.current;
		if (!card) return;
		const next: Record<string, boolean> = {};
		const textNodes = card.querySelectorAll<HTMLElement>('[data-checklist-text-id]');
		for (const node of textNodes) {
			const id = String(node.dataset.checklistTextId ?? '').trim();
			if (!id) continue;
			const style = window.getComputedStyle(node);
			const fontSize = Number.parseFloat(style.fontSize || '0') || 14;
			const parsedLineHeight = Number.parseFloat(style.lineHeight || '0') || 0;
			const lineHeight = parsedLineHeight > 0 ? parsedLineHeight : fontSize * 1.35;
			const expectedSingleLine = Math.ceil(lineHeight + 2);
			next[id] = node.scrollHeight > expectedSingleLine + 4;
		}
		setMultilineById((prev) => {
			const prevKeys = Object.keys(prev);
			const nextKeys = Object.keys(next);
			if (prevKeys.length === nextKeys.length && nextKeys.every((key) => prev[key] === next[key])) {
				return prev;
			}
			return next;
		});
	}, [normalizedItems, showCompleted, type]);
	// Pointer tracking distinguishes tap-to-open from drag/move gestures.
	const pointerDownRef = React.useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);
	// Long-press timer: fires the more-menu after 400ms without movement on touch devices.
	const longPressTimerRef = React.useRef<number>(0);
	const longPressFiredRef = React.useRef(false);

	const clearLongPressTimer = React.useCallback((): void => {
		if (longPressTimerRef.current) {
			window.clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = 0;
		}
	}, []);

	const tryOpen = React.useCallback((): void => {
		if (!props.onOpen) return;
		if (props.shouldSuppressOpen?.()) return;
		props.onOpen();
	}, [props]);

	const toggleCompletedSection = React.useCallback((): void => {
		setShowCompleted((prev) => {
			const next = !prev;
			setNoteCardCompletedExpanded(props.noteId, next);
			void updateUserPreferences(getDeviceId(), {
				noteCardCompletedExpandedPatch: { noteId: props.noteId, expanded: next },
			});
			return next;
		});
	}, [props.noteId]);

	return (
		<article
			ref={cardRef}
			className={`${styles.card}${type === 'checklist' ? ` ${styles.checklistCard}` : ''}`}
			data-note-card="true"
			aria-label={`Note ${props.noteId}`}
			role={props.onOpen ? 'button' : undefined}
			tabIndex={props.onOpen ? 0 : undefined}
			onPointerDown={(e) => {
				// Track initial point; open action is decided on pointer up if movement stayed small.
				if (!props.onOpen) return;
				if (isInteractiveTarget(e.target)) return;
				// If the touch started on the drag handle (header), let
				// pragmatic-drag-and-drop own the gesture — don't capture the
				// pointer or start the long-press (more-menu) timer.
				const target = e.target as HTMLElement | null;
				const isDragHandle = Boolean(target?.closest('[data-drag-handle="true"]'));
				// Touch/coarse branch: capture the pointer so this interaction stays
				// bound to the card element even if the editor overlay mounts before
				// compatibility events are delivered.
				if (!isDragHandle && (e.pointerType === 'touch' || isCoarsePointerDevice()) && e.currentTarget.hasPointerCapture && e.currentTarget.setPointerCapture) {
					try {
						e.currentTarget.setPointerCapture(e.pointerId);
					} catch {
						// Ignore browsers/devices that reject capture for this pointer.
					}
				}
				pointerDownRef.current = {
					x: e.clientX,
					y: e.clientY,
					moved: false,
					pointerId: e.pointerId,
				};
							// Long-press timer (touch/coarse only): start a 400ms timer.
							// If the pointer doesn't move >6px before it fires, open the more-menu.
							// This is intentionally disabled for touches that start on the drag
							// handle so drag gestures don't accidentally open the menu.
				longPressFiredRef.current = false;
				clearLongPressTimer();
				if (!isDragHandle && props.onMoreMenu && (e.pointerType === 'touch' || isCoarsePointerDevice())) {
					const onMoreMenu = props.onMoreMenu;
					longPressTimerRef.current = window.setTimeout(() => {
						longPressTimerRef.current = 0;
						const state = pointerDownRef.current;
						if (!state || state.moved) return;
						longPressFiredRef.current = true;
						pointerDownRef.current = null;
						// Clear any native text selection Android may have
						// started during the long-press gesture.
						window.getSelection()?.removeAllRanges();
						onMoreMenu();
					}, 400);
				}
			}}
			onPointerMove={(e) => {
				// Mark as moved beyond threshold to suppress accidental open during drag/scroll.
				const state = pointerDownRef.current;
				if (!state) return;
				if (state.pointerId !== e.pointerId) return;
				const dx = e.clientX - state.x;
				const dy = e.clientY - state.y;
				if (dx * dx + dy * dy > 36) {
					state.moved = true;
					clearLongPressTimer();
				}
			}}
			onPointerUp={(e) => {
				// Treat as click/tap only if the pointer did not move significantly.
				clearLongPressTimer();
				if (e.currentTarget.hasPointerCapture && e.currentTarget.releasePointerCapture) {
					try {
						e.currentTarget.releasePointerCapture(e.pointerId);
					} catch {
						// Ignore if the pointer wasn't captured.
					}
				}
				const state = pointerDownRef.current;
				pointerDownRef.current = null;
				if (!state) return;
				if (state.pointerId !== e.pointerId) return;
				if (state.moved) return;
				if (longPressFiredRef.current) return;
				if (isInteractiveTarget(e.target)) return;
				// Touch/coarse branch: the same physical tap can generate delayed
				// compatibility mouse events. We suppress them before opening so they
				// cannot retarget into the newly mounted editor controls.
				if (e.pointerType === 'touch' || isCoarsePointerDevice()) {
					if (e.cancelable) e.preventDefault();
					e.stopPropagation();
					suppressNextDocumentCompatibilityMouseEvents();
				}
				tryOpen();
			}}
			onPointerCancel={(e) => {
				// Cancellation branch: always release any capture to avoid pointer
				// lifecycle leaks that can affect subsequent gestures.
				clearLongPressTimer();
				if (e.currentTarget.hasPointerCapture && e.currentTarget.releasePointerCapture) {
					try {
						e.currentTarget.releasePointerCapture(e.pointerId);
					} catch {
						// Ignore if the pointer wasn't captured.
					}
				}
				pointerDownRef.current = null;
			}}
			onKeyDown={(e) => {
				if (!props.onOpen) return;
				if (e.currentTarget !== e.target) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					tryOpen();
				}
			}}
		>
			<div
				className={styles.header}
				ref={props.dragHandleRef}
				data-drag-handle="true"
				{...props.dragHandleProps}
				onClick={(e) => {
					// Drag-handle clicks should not bubble and open the note.
					e.stopPropagation();
				}}
			>
				<span className={styles.headerTitle}>{title.trim().length > 0 ? title : t('note.untitled')}</span>
				{props.hasPendingSync ? (
					<span aria-label={t('note.pendingSync')} title={t('note.pendingSync')} className={styles.pendingSync}>
						↻
					</span>
				) : null}
			</div>

			{type === 'text' ? (
				<div className={styles.body}>
					<div className={styles.contentPreview}>{content}</div>
				</div>
			) : (
				<>
					<div className={styles.body}>
						<ul className={styles.checklist}>
							{activeChecklistItems.map((item) => (
								<li key={item.id} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''}${item.parentId ? ` ${styles.childItem}` : ''}`}>
									<input
										type="checkbox"
										className={styles.checklistCheckbox}
										checked={item.completed}
										onPointerDown={(e) => e.stopPropagation()}
										onPointerUp={(e) => e.stopPropagation()}
										onClick={(e) => e.stopPropagation()}
										onChange={(e) => updateChecklistItemById(checklistArray, item.id, { completed: e.target.checked })}
									/>
									<span className={styles.checklistText} data-checklist-text-id={item.id}>{item.text}</span>
								</li>
							))}
						</ul>
					</div>

					{completedChecklistItems.length > 0 ? (
						<div className={styles.completedSection}>
							<button
								type="button"
								className={styles.completedToggle}
								onPointerDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									toggleCompletedSection();
								}}
							>
								{showCompleted ? '▾' : '▸'} {completedChecklistItems.length} {t('editors.completedItems')}
							</button>
							{showCompleted ? (
								<ul className={styles.checklist}>
									{completedChecklistItems.map((item) => (
										<li key={item.id} className={`${styles.checklistItem}${multilineById[item.id] ? ` ${styles.checklistItemMultiline}` : ''}${item.parentId ? ` ${styles.childItem}` : ''}`}>
											<input
												type="checkbox"
												className={styles.checklistCheckbox}
												checked={item.completed}
												onPointerDown={(e) => e.stopPropagation()}
												onPointerUp={(e) => e.stopPropagation()}
												onClick={(e) => e.stopPropagation()}
											onChange={(e) => updateChecklistItemById(checklistArray, item.id, { completed: e.target.checked })}
											/>
											<span className={styles.checklistTextCompleted} data-checklist-text-id={item.id}>{item.text}</span>
										</li>
									))}
								</ul>
							) : null}
						</div>
					) : null}
				</>
			)}
		</article>
	);
}
