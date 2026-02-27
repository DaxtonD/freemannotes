import React from 'react';
import * as Y from 'yjs';
import { ChecklistBinding, type ChecklistItem } from './core/bindings';

export type NoteCardProps = {
	noteId: string;
	doc: Y.Doc;
	// Branch: called when user clicks (no drag) to open the editor.
	onOpen?: () => void;
	// Branch: NoteGrid can suppress opens right after a drag ends.
	shouldSuppressOpen?: () => boolean;
	// Branch: dnd-kit handle-only dragging. These are applied ONLY to the header.
	dragHandleRef?: (node: HTMLDivElement | null) => void;
	dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
};

type NoteType = 'text' | 'checklist';

function useYTextValue(ytext: Y.Text): string {
	return React.useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext.toString(),
		() => ytext.toString()
	);
}

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

function useChecklistItems(binding: ChecklistBinding): readonly ChecklistItem[] {
	return React.useSyncExternalStore(
		(onStoreChange) => binding.subscribe(onStoreChange),
		() => binding.getItems(),
		() => binding.getItems()
	);
}

export function NoteCard(props: NoteCardProps): React.JSX.Element {
	const title = useYTextValue(React.useMemo(() => props.doc.getText('title'), [props.doc]));
	const content = useYTextValue(React.useMemo(() => props.doc.getText('content'), [props.doc]));
	const metadata = React.useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const typeValue = useMetadataString(metadata, 'type');
	const type: NoteType = typeValue === 'checklist' ? 'checklist' : 'text';

	const checklistBinding = React.useMemo(
		() =>
			new ChecklistBinding({
				yarray: props.doc.getArray<Y.Map<any>>('checklist'),
				onUpdate: () => {
					// Branch: NoteCard uses useSyncExternalStore listener updates.
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
	const pointerDownRef = React.useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);

	const tryOpen = React.useCallback((): void => {
		// Branch: no open handler provided.
		if (!props.onOpen) return;
		// Branch: grid says we just dragged, ignore the click.
		if (props.shouldSuppressOpen?.()) return;
		props.onOpen();
	}, [props]);

	return (
		<article className="note-card" aria-label={`Note ${props.noteId}`}>
			{/* Branch: this header is the ONLY drag handle (dnd-kit listeners attach here). */}
			<div
				className="note-header"
				style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}
				ref={props.dragHandleRef}
				{...props.dragHandleProps}
				onClick={(e) => {
					// Branch: clicking/dragging the handle should never open the editor.
					e.stopPropagation();
				}}
			>
				<span style={{ flex: 1 }}>{title.trim().length > 0 ? title : '(untitled)'}</span>
				<span style={{ fontSize: 12, opacity: 0.6 }}>{type}</span>
			</div>

			{/* Branch: clicking body (without dragging) opens the editor. */}
			<div
				className="note-body"
				role={props.onOpen ? 'button' : undefined}
				tabIndex={props.onOpen ? 0 : undefined}
				onPointerDown={(e) => {
					// Branch: only primary pointer should trigger open detection.
					pointerDownRef.current = {
						x: e.clientX,
						y: e.clientY,
						moved: false,
						pointerId: e.pointerId,
					};
				}}
				onPointerMove={(e) => {
					const state = pointerDownRef.current;
					if (!state) return;
					if (state.pointerId !== e.pointerId) return;
					const dx = e.clientX - state.x;
					const dy = e.clientY - state.y;
					// Branch: small drag threshold guard.
					if (dx * dx + dy * dy > 36) {
						state.moved = true;
					}
				}}
				onPointerUp={(e) => {
					const state = pointerDownRef.current;
					pointerDownRef.current = null;
					if (!state) return;
					if (state.pointerId !== e.pointerId) return;
					// Branch: if user dragged, do not open.
					if (state.moved) return;
					tryOpen();
				}}
				onPointerCancel={() => {
					pointerDownRef.current = null;
				}}
				onKeyDown={(e) => {
					// Branch: keyboard open for quick testing.
					if (!props.onOpen) return;
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						tryOpen();
					}
				}}
			>
			{/* Branch: render text note content. */}
			{type === 'text' ? (
				<div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
			) : (
				/* Branch: render checklist note content. */
				<ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
					{checklistItems.map((item) => (
						<li key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<input
								type="checkbox"
								checked={item.completed}
								onClick={(e) => {
									// Branch: checking items should not open the editor.
									e.stopPropagation();
								}}
								onChange={(e) => checklistBinding.updateById(item.id, { completed: e.target.checked })}
							/>
							<span style={{ textDecoration: item.completed ? 'line-through' : 'none' }}>{item.text}</span>
						</li>
					))}
				</ul>
			)}
			</div>
		</article>
	);
}
