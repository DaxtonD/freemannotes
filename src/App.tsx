import React from 'react';
import type * as Y from 'yjs';
import { ChecklistNoteEditor } from './ChecklistNoteEditor';
import { NoteGrid } from './NoteGrid';
import { NoteEditor } from './NoteEditor';
import { TextNoteEditor } from './TextNoteEditor';
import { ChecklistBinding, type ChecklistItem } from './core/bindings';
import { useDocumentManager } from './core/DocumentManagerContext';

type EditorMode = 'none' | 'text' | 'checklist';

function makeId(prefix: string): string {
	// Branch: modern browsers.
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	// Branch: fallback for environments without randomUUID.
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveTextToDoc(doc: Y.Doc, title: string, body: string): void {
	const yTitle = doc.getText('title');
	const yContent = doc.getText('content');
	const metadata = doc.getMap<any>('metadata');

	doc.transact(() => {
		yTitle.delete(0, yTitle.length);
		yTitle.insert(0, title);

		yContent.delete(0, yContent.length);
		yContent.insert(0, body);

		metadata.set('type', 'text');
		metadata.set('createdAt', Date.now());
	});
}

function saveChecklistToDoc(doc: Y.Doc, title: string, items: readonly ChecklistItem[]): void {
	const yTitle = doc.getText('title');
	const yContent = doc.getText('content');
	const metadata = doc.getMap<any>('metadata');
	const yChecklist = doc.getArray<Y.Map<any>>('checklist');

	doc.transact(() => {
		yTitle.delete(0, yTitle.length);
		yTitle.insert(0, title);

		yContent.delete(0, yContent.length);

		metadata.set('type', 'checklist');
		metadata.set('createdAt', Date.now());

		if (yChecklist.length > 0) {
			yChecklist.delete(0, yChecklist.length);
		}
	});

	const binding = new ChecklistBinding({
		yarray: yChecklist,
		onUpdate: () => {
			// Branch: this write-only binding is only for checklist item creation.
		},
	});

	try {
		for (const item of items) {
			binding.add({
				id: item.id,
				text: item.text,
				completed: item.completed,
			});
		}
	} finally {
		binding.destroy();
	}
}

export function App(): React.JSX.Element {
	const manager = useDocumentManager();
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);

	const onSaveText = React.useCallback(
		async (args: { title: string; body: string }) => {
			const id = makeId('text-note');
			await manager.createNote(id, args.title);
			const doc = await manager.getDocWithSync(id);
			saveTextToDoc(doc, args.title, args.body);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	const onSaveChecklist = React.useCallback(
		async (args: { title: string; items: ChecklistItem[] }) => {
			const id = makeId('checklist-note');
			await manager.createNote(id, args.title);
			const doc = await manager.getDocWithSync(id);
			saveChecklistToDoc(doc, args.title, args.items);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	React.useEffect(() => {
		let cancelled = false;
		// Branch: nothing selected.
		if (!selectedNoteId) {
			setOpenDoc(null);
			setOpenDocId(null);
			return;
		}

		(async () => {
			// Branch: offline-first; does not block on websocket connect.
			const doc = await manager.getDocWithSync(selectedNoteId);
			if (cancelled) return;
			setOpenDoc(doc);
			setOpenDocId(selectedNoteId);
		})().catch((err) => {
			console.error('[CRDT] Failed to open note:', err);
		});

		return () => {
			cancelled = true;
		};
	}, [manager, selectedNoteId]);

	return (
		<div className="test-harness-root">
			<div className="top-actions">
				<button type="button" onClick={() => setEditorMode('text')}>
					New Text Note
				</button>
				<button type="button" onClick={() => setEditorMode('checklist')}>
					New Checklist
				</button>
			</div>

			<section className="editor-panel">
				{/* Branch: no editor open. */}
				{editorMode === 'none' ? <div>Choose a button to create a note.</div> : null}
				{/* Branch: text editor open. */}
				{editorMode === 'text' ? <TextNoteEditor onSave={onSaveText} onCancel={() => setEditorMode('none')} /> : null}
				{/* Branch: checklist editor open. */}
				{editorMode === 'checklist' ? (
					<ChecklistNoteEditor onSave={onSaveChecklist} onCancel={() => setEditorMode('none')} />
				) : null}
			</section>

			<NoteGrid
				selectedNoteId={selectedNoteId}
				onSelectNote={(id) => {
					// Branch: selecting a note should close the create editor.
					setEditorMode('none');
					setSelectedNoteId(id);
				}}
			/>

			<section className="editor-panel">
				{/* Branch: no selection yet. */}
				{!selectedNoteId ? <div>Click a note card body to edit.</div> : null}
				{/* Branch: selection exists but doc not yet loaded. */}
				{selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? <div>Loading editor...</div> : null}
				{/* Branch: single active editor for the selected note. */}
				{selectedNoteId && openDoc && openDocId === selectedNoteId ? (
					<NoteEditor noteId={selectedNoteId} doc={openDoc} onClose={() => setSelectedNoteId(null)} />
				) : null}
			</section>
		</div>
	);
}
