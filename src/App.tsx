import React from 'react';
import type * as Y from 'yjs';
import { ChecklistEditor } from './components/Editors/ChecklistEditor';
import { NoteEditor } from './components/Editors/NoteEditor';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid } from './components/NoteGrid/NoteGrid';
import { type ChecklistItem } from './core/bindings';
import { useDocumentManager } from './core/DocumentManagerContext';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId } from './core/noteModel';
import { useConnectionStatus } from './core/useConnectionStatus';

type EditorMode = 'none' | 'text' | 'checklist';

export function App(): React.JSX.Element {
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// The currently selected note in the grid/editor area.
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	// Loaded Y.Doc for the selected note.
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);
	// Card-height preference (UI-only for now). Width is handled separately in NoteGrid.
	const [maxCardHeightPx, setMaxCardHeightPx] = React.useState<number>(300);

	const handleMaxCardHeightInput = React.useCallback((next: string): void => {
		const parsed = Number(next);
		if (!Number.isFinite(parsed)) return;
		setMaxCardHeightPx(parsed);
	}, []);

	React.useEffect(() => {
		// Keep style tokens in CSS so NoteCard truncation and max-height stay in sync.
		const root = document.documentElement;
		root.style.setProperty('--note-card-max-height', `${maxCardHeightPx}px`);
		const lineClamp = Math.max(2, Math.floor((maxCardHeightPx - 40) / 18));
		root.style.setProperty('--note-content-line-clamp', String(lineClamp));
		return () => {
			root.style.removeProperty('--note-card-max-height');
			root.style.removeProperty('--note-content-line-clamp');
		};
	}, [maxCardHeightPx]);

	const onSaveText = React.useCallback(
		async (args: { title: string; body: string }) => {
			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('text-note');
			const doc = await manager.getDocWithSync(id);
			initTextNoteDoc(doc, args.title, args.body);
			await manager.createNote(id, args.title);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	const onSaveChecklist = React.useCallback(
		async (args: { title: string; items: ChecklistItem[] }) => {
			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('checklist-note');
			const doc = await manager.getDocWithSync(id);
			initChecklistNoteDoc(doc, args.title, args.items);
			await manager.createNote(id, args.title);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	const onDeleteSelectedNote = React.useCallback(
		async (noteId: string) => {
			// Soft-delete: mark as trashed in the Yjs metadata. The note stays
			// in the registry and order arrays but is hidden from the main grid.
			// Server-side cleanup permanently removes it after deleteAfterDays.
			await manager.trashNote(noteId);
			setSelectedNoteId((prev) => (prev === noteId ? null : prev));
			setOpenDocId((prevId) => {
				if (prevId !== noteId) return prevId;
				setOpenDoc(null);
				return null;
			});
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
			// Offline-first open: return as soon as IndexedDB-hydrated doc is ready.
			// WebSocket sync wiring is established by DocumentManager in parallel.
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
			<div className="connection-indicator" aria-live="polite" title={`Connection: ${connection.state}`}>
				<span aria-hidden="true" className="connection-dot">
					{connection.state === 'connected' ? '🟢' : connection.state === 'connecting' ? '🟡' : '🔴'}
				</span>
			</div>

			{/* Live style control for card max height (used by grid previews + editor summaries). */}
			<section className="editor-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
				<label htmlFor="max-height-slider" style={{ fontSize: 12, opacity: 0.85 }}>
					Card max height: {maxCardHeightPx}px
				</label>
				<input
					id="max-height-slider"
					type="range"
					min={100}
					max={600}
					step={25}
					value={maxCardHeightPx}
					onInput={(e) => handleMaxCardHeightInput((e.target as HTMLInputElement).value)}
					onChange={(e) => handleMaxCardHeightInput(e.target.value)}
				/>
			</section>

			<div className="top-actions">
				{/* Entry points for creating new notes; note type is persisted in metadata.type. */}
				<button type="button" onClick={() => setEditorMode('text')}>
					New Text Note
				</button>
				<button type="button" onClick={() => setEditorMode('checklist')}>
					New Checklist
				</button>
			</div>

			<section className="editor-panel">
				{/* Branch: text editor open. */}
				{editorMode === 'text' ? <TextEditor onSave={onSaveText} onCancel={() => setEditorMode('none')} /> : null}
				{/* Branch: checklist editor open. */}
				{editorMode === 'checklist' ? (
					<ChecklistEditor onSave={onSaveChecklist} onCancel={() => setEditorMode('none')} />
				) : null}
			</section>

			<NoteGrid
				// Width behavior (desktop vs mobile, portrait/landscape) is centralized in NoteGrid.
				selectedNoteId={selectedNoteId}
				maxCardHeightPx={maxCardHeightPx}
				onSelectNote={(id) => {
					// Branch: selecting a note should close the create editor.
					setEditorMode('none');
					setSelectedNoteId(id);
				}}
			/>

			<section className="editor-panel">
				{/* Branch: selection exists but doc not yet loaded. */}
				{selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? <div>Loading editor...</div> : null}
				{/* Branch: single active editor for the selected note. */}
				{selectedNoteId && openDoc && openDocId === selectedNoteId ? (
					<NoteEditor
						noteId={selectedNoteId}
						doc={openDoc}
						onClose={() => setSelectedNoteId(null)}
						onDelete={onDeleteSelectedNote}
					/>
				) : null}
			</section>
		</div>
	);
}
