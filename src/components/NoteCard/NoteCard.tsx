import React from 'react';
import * as Y from 'yjs';
import { ChecklistBinding, type ChecklistItem } from '../../core/bindings';
import { normalizeChecklistHierarchy } from '../../core/checklistHierarchy';
import { useI18n } from '../../core/i18n';
import styles from './NoteCard.module.css';

const completedExpandedByNoteId = new Map<string, boolean>();

export type NoteCardProps = {
	noteId: string;
	doc: Y.Doc;
	hasPendingSync?: boolean;
	onOpen?: () => void;
	shouldSuppressOpen?: () => boolean;
	dragHandleRef?: (node: HTMLDivElement | null) => void;
	dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
	maxCardHeightPx?: number;
};

type NoteType = 'text' | 'checklist';

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
function useChecklistItems(binding: ChecklistBinding): readonly ChecklistItem[] {
	return React.useSyncExternalStore(
		(onStoreChange) => binding.subscribe(onStoreChange),
		() => binding.getItems(),
		() => binding.getItems()
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

	const checklistBinding = React.useMemo(
		() =>
			new ChecklistBinding({
				yarray: props.doc.getArray<Y.Map<any>>('checklist'),
				onUpdate: () => {
					// React updates via useSyncExternalStore.
				},
			}),
		[props.doc]
	);

	React.useEffect(() => {
		return () => {
			checklistBinding.destroy();
		};
	}, [checklistBinding]);

	const checklistItems = useChecklistItems(checklistBinding);
	const normalizedItems = React.useMemo(() => normalizeChecklistHierarchy(checklistItems), [checklistItems]);
	const [showCompleted, setShowCompleted] = React.useState<boolean>(() => completedExpandedByNoteId.get(props.noteId) ?? false);

	React.useEffect(() => {
		setShowCompleted(completedExpandedByNoteId.get(props.noteId) ?? false);
	}, [props.noteId]);
	const activeChecklistItems = React.useMemo(() => normalizedItems.filter((item) => !item.completed), [normalizedItems]);
	const completedChecklistItems = React.useMemo(() => normalizedItems.filter((item) => item.completed), [normalizedItems]);
	// Pointer tracking distinguishes tap-to-open from drag/move gestures.
	const pointerDownRef = React.useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);

	const tryOpen = React.useCallback((): void => {
		if (!props.onOpen) return;
		if (props.shouldSuppressOpen?.()) return;
		props.onOpen();
	}, [props]);

	const toggleCompletedSection = React.useCallback((): void => {
		setShowCompleted((prev) => {
			const next = !prev;
			completedExpandedByNoteId.set(props.noteId, next);
			return next;
		});
	}, [props.noteId]);

	return (
		<article
			className={`${styles.card}${type === 'checklist' ? ` ${styles.checklistCard}` : ''}`}
			data-note-card="true"
			aria-label={`Note ${props.noteId}`}
			role={props.onOpen ? 'button' : undefined}
			tabIndex={props.onOpen ? 0 : undefined}
			onPointerDown={(e) => {
				// Track initial point; open action is decided on pointer up if movement stayed small.
				if (!props.onOpen) return;
				pointerDownRef.current = {
					x: e.clientX,
					y: e.clientY,
					moved: false,
					pointerId: e.pointerId,
				};
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
				}
			}}
			onPointerUp={(e) => {
				// Treat as click/tap only if the pointer did not move significantly.
				const state = pointerDownRef.current;
				pointerDownRef.current = null;
				if (!state) return;
				if (state.pointerId !== e.pointerId) return;
				if (state.moved) return;
				tryOpen();
			}}
			onPointerCancel={() => {
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
								<li key={item.id} className={`${styles.checklistItem}${item.parentId ? ` ${styles.childItem}` : ''}`}>
									<input
										type="checkbox"
										className={styles.checklistCheckbox}
										checked={item.completed}
										onPointerDown={(e) => e.stopPropagation()}
										onPointerUp={(e) => e.stopPropagation()}
										onClick={(e) => e.stopPropagation()}
										onChange={(e) => checklistBinding.updateById(item.id, { completed: e.target.checked })}
									/>
									<span className={styles.checklistText}>{item.text}</span>
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
										<li key={item.id} className={`${styles.checklistItem}${item.parentId ? ` ${styles.childItem}` : ''}`}>
											<input
												type="checkbox"
												className={styles.checklistCheckbox}
												checked={item.completed}
												onPointerDown={(e) => e.stopPropagation()}
												onPointerUp={(e) => e.stopPropagation()}
												onClick={(e) => e.stopPropagation()}
												onChange={(e) => checklistBinding.updateById(item.id, { completed: e.target.checked })}
											/>
											<span className={styles.checklistTextCompleted}>{item.text}</span>
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
