import React, { useMemo, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { ChecklistBinding, HeadlessTextEditor, TextBinding, type ChecklistItem } from './core/bindings';

export type NoteEditorProps = {
	noteId: string;
	doc: Y.Doc;
	onClose: () => void;
};

type TextBindingBundle = {
	ytext: Y.Text;
	editor: HeadlessTextEditor;
	binding: TextBinding;
};

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
	while (
		prevEnd >= start &&
		nextEnd >= start &&
		prev.charCodeAt(prevEnd) === next.charCodeAt(nextEnd)
	) {
		prevEnd--;
		nextEnd--;
	}

	const deleteLen = prevEnd >= start ? prevEnd - start + 1 : 0;
	const insertText = nextEnd >= start ? next.slice(start, nextEnd + 1) : '';

	const doc = (ytext as any).doc as Y.Doc | null | undefined;
	const apply = (): void => {
		if (deleteLen > 0) {
			ytext.delete(start, deleteLen);
		}
		if (insertText.length > 0) {
			ytext.insert(start, insertText);
		}
	};

	if (doc) {
		doc.transact(apply);
	} else {
		apply();
	}

	if (ytext.toString() !== next) {
		const fallback = (): void => {
			ytext.delete(0, ytext.length);
			if (next.length > 0) {
				ytext.insert(0, next);
			}
		};
		if (doc) {
			doc.transact(fallback);
		} else {
			fallback();
		}
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

function useChecklistItems(binding: ChecklistBinding): readonly ChecklistItem[] {
	return useSyncExternalStore(
		(onStoreChange) => binding.subscribe(onStoreChange),
		() => binding.getItems(),
		() => binding.getItems()
	);
}

export function NoteEditor(props: NoteEditorProps): React.JSX.Element {
	const titleBundle = useMemo<TextBindingBundle>(() => {
		const ytext = props.doc.getText('title');
		const editor = new HeadlessTextEditor();
		const binding = new TextBinding({
			ytext,
			editor,
			onUpdate: () => {
				// React rerenders through editor subscriptions; no state mirror here.
			},
		});
		return { ytext, editor, binding };
	}, [props.doc]);

	const contentBundle = useMemo<TextBindingBundle>(() => {
		const ytext = props.doc.getText('content');
		const editor = new HeadlessTextEditor();
		const binding = new TextBinding({
			ytext,
			editor,
			onUpdate: () => {
				// React rerenders through editor subscriptions.
			},
		});
		return { ytext, editor, binding };
	}, [props.doc]);

	const checklist = useMemo(() => {
		return new ChecklistBinding({
			yarray: props.doc.getArray<Y.Map<any>>('checklist'),
			onUpdate: () => {
				// React rerenders via checklist subscription.
			},
		});
	}, [props.doc]);

	React.useEffect(() => {
		return () => {
			titleBundle.binding.destroy();
			contentBundle.binding.destroy();
			checklist.destroy();
		};
	}, [titleBundle, contentBundle, checklist]);

	const title = useYTextValue(titleBundle.ytext);
	const content = useYTextValue(contentBundle.ytext);
	const items = useChecklistItems(checklist);

	return (
		<section aria-label={`Editor ${props.noteId}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
			<div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
				<div style={{ fontSize: 12, opacity: 0.8 }}>Editing: {props.noteId}</div>
				<button type="button" onClick={props.onClose}>
					Close
				</button>
			</div>

			<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				<span>Title</span>
				<input
					value={title}
					onChange={(e) => setYTextValue(titleBundle.ytext, e.target.value)}
					placeholder="Untitled"
				/>
			</label>

			<label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				<span>Content</span>
				<textarea
					value={content}
					onChange={(e) => setYTextValue(contentBundle.ytext, e.target.value)}
					rows={10}
					placeholder="Start typing…"
				/>
			</label>

			<section aria-label="Checklist" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

				<ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
					{items.map((item) => (
						<li key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
							<input
								type="checkbox"
								checked={item.completed}
								onChange={(e) => checklist.updateById(item.id, { completed: e.target.checked })}
							/>
							<input
								value={item.text}
								onChange={(e) => checklist.updateById(item.id, { text: e.target.value })}
								style={{ flex: 1 }}
							/>
							<button type="button" onClick={() => checklist.removeById(item.id)}>
								Remove
							</button>
						</li>
					))}
				</ul>
			</section>
		</section>
	);
}
