import React, { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { ChecklistBinding, HeadlessTextEditor, TextBinding, type ChecklistItem } from '../../core/bindings';
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
	const [isDeleting, setIsDeleting] = React.useState(false);
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

	return (
		<section aria-label={`Editor ${props.noteId}`} className={styles.editorContainer}>
			<div className={styles.editorHeader}>
				<div className={styles.editorMeta}>Editing: {props.noteId}</div>
				<div className={styles.editorActions}>
					<button type="button" onClick={handleDelete} disabled={isDeleting}>
						{isDeleting ? 'Deleting…' : 'Delete'}
					</button>
					<button type="button" onClick={props.onClose} disabled={isDeleting}>
						Close
					</button>
				</div>
			</div>

			<label className={styles.field}>
				<span>Title</span>
				<input value={title} onChange={(e) => setYTextValue(titleBundle.ytext, e.target.value)} placeholder="Untitled" />
			</label>

			{type === 'text' && contentBundle ? (
				<label className={styles.field}>
					<span>Content</span>
					<textarea
						value={content}
						onChange={(e) => setYTextValue(contentBundle.ytext, e.target.value)}
						rows={10}
						placeholder="Start typing…"
					/>
				</label>
			) : null}

			{type === 'checklist' && checklist ? (
				<section aria-label="Checklist" className={styles.editorContainer}>
					<div className={styles.editorHeader}>
						<span>Checklist</span>
						<button
							type="button"
							onClick={() => {
								const id =
									typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
										? crypto.randomUUID()
										: String(Date.now());
								checklist.add({ id, text: 'New item', completed: false });
							}}
						>
							Add
						</button>
					</div>

					<ul className={styles.checklistList}>
						{items.map((item) => (
							<li key={item.id} className={styles.checklistItem}>
								<input
									type="checkbox"
									checked={item.completed}
									onChange={(e) => checklist.updateById(item.id, { completed: e.target.checked })}
								/>
								<input
									value={item.text}
									onChange={(e) => checklist.updateById(item.id, { text: e.target.value })}
									className={styles.grow}
								/>
								<button type="button" onClick={() => checklist.removeById(item.id)}>
									Remove
								</button>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</section>
	);
}
