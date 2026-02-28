import React from 'react';
import * as Y from 'yjs';
import { ChecklistBinding, type ChecklistItem } from '../../core/bindings';
import styles from './NoteCard.module.css';

export type NoteCardProps = {
	noteId: string;
	doc: Y.Doc;
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
	// Preview item count scales with card max-height preference.
	const checklistPreviewLimit = React.useMemo(() => {
		const maxHeight = props.maxCardHeightPx ?? 300;
		return Math.max(3, Math.floor((maxHeight - 52) / 28));
	}, [props.maxCardHeightPx]);
	// Pointer tracking distinguishes tap-to-open from drag/move gestures.
	const pointerDownRef = React.useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);

	const tryOpen = React.useCallback((): void => {
		if (!props.onOpen) return;
		if (props.shouldSuppressOpen?.()) return;
		props.onOpen();
	}, [props]);

	return (
		<article
			className={styles.card}
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
				<span className={styles.headerTitle}>{title.trim().length > 0 ? title : '(untitled)'}</span>
				<span className={styles.headerType}>{type}</span>
			</div>

			<div className={styles.body}>
				{type === 'text' ? (
					<div className={styles.contentPreview}>{content}</div>
				) : (
					<ul className={styles.checklist}>
						{checklistItems.slice(0, checklistPreviewLimit).map((item) => (
							<li key={item.id} className={styles.checklistItem}>
								<input
									type="checkbox"
									checked={item.completed}
									onPointerDown={(e) => e.stopPropagation()}
									onPointerUp={(e) => e.stopPropagation()}
									onClick={(e) => e.stopPropagation()}
									onChange={(e) => checklistBinding.updateById(item.id, { completed: e.target.checked })}
								/>
								<span style={{ textDecoration: item.completed ? 'line-through' : 'none' }}>{item.text}</span>
							</li>
						))}
						{checklistItems.length > checklistPreviewLimit ? <li className={styles.checklistMore}>…</li> : null}
					</ul>
				)}
			</div>
		</article>
	);
}
