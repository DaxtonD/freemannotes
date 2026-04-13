/**
 * CrossWorkspaceNoteModal
 *
 * Opens a note that belongs to a non-active workspace directly from the
 * bubble view without switching the active workspace.
 *
 * Creates its own Y.Doc + IndexeddbPersistence (the same IDB room name the
 * bubble view already populated during its background load) and then wires up
 * a WebsocketProvider so edits are live-synced to the server.
 *
 * Because this component owns its providers it cleans up completely on unmount,
 * leaving no dangling IDB locks or WebSocket connections.
 */

import React from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import { NoteEditor } from '../Editors/NoteEditor';
import { readNoteFromDoc, setNoteTrashed } from '../../core/noteModel';
import { assignNotePinned, readNoteMetadataState } from '../../services/noteService';
import type { ThemeId } from '../../core/theme';
import styles from './CrossWorkspaceNoteModal.module.css';

const LOADING_INDICATOR_DELAY_MS = 120;
const IDB_HYDRATION_FALLBACK_MS = 240;
const REMOTE_SYNC_FALLBACK_MS = 2000;

function docHasRenderableContent(doc: Y.Doc, noteId: string): boolean {
	const note = readNoteFromDoc(doc, noteId);
	if (note.title.trim().length > 0) return true;
	if (note.type === 'checklist') {
		return Array.isArray(note.items) && note.items.some((item) => String(item.text ?? '').trim().length > 0);
	}
	return typeof note.content === 'string' && note.content.trim().length > 0;
}

export type CrossWorkspaceNoteModalProps = {
	noteId: string;
	docId: string;
	workspaceId: string;
	workspaceName: string;
	themeId: ThemeId;
	authUserId?: string | null;
	websocketUrl: string;
	readOnly?: boolean;
	onAddCollaborator?: (args: { noteId: string; docId: string; title: string }) => void;
	onAddImage?: (args: { noteId: string; docId: string; title: string }) => void;
	onAddDocument?: (args: { noteId: string; docId: string; title: string }) => void;
	onAddReminder?: (args: { noteId: string; docId: string; title: string }) => void;
	onAddToCollection?: (args: { noteId: string; doc: Y.Doc; docId: string; title: string }) => void;
	onAddLabels?: (args: { noteId: string; doc: Y.Doc; docId: string; title: string }) => void;
	onShowBriefDialog?: (message: string) => void;
	initialShowCompleted?: boolean;
	allowQuickDelete?: boolean;
	onClose: () => void;
};

export function CrossWorkspaceNoteModal({
	noteId,
	docId,
	workspaceId,
	workspaceName,
	themeId,
	authUserId,
	websocketUrl,
	readOnly = false,
	onAddCollaborator,
	onAddImage,
	onAddDocument,
	onAddReminder,
	onAddToCollection,
	onAddLabels,
	onShowBriefDialog,
	initialShowCompleted,
	allowQuickDelete,
	onClose,
}: CrossWorkspaceNoteModalProps): React.JSX.Element {
	const [doc, setDoc] = React.useState<Y.Doc | null>(null);
	const [showLoading, setShowLoading] = React.useState(false);

	// Each (noteId, workspaceId) pair gets its own providers. We use a ref so
	// the cleanup effect always has the latest set of providers to destroy.
	const providersRef = React.useRef<{
		ydoc: Y.Doc;
		idb: IndexeddbPersistence;
		ws: WebsocketProvider | null;
	} | null>(null);

	React.useEffect(() => {
		const roomName = docId;
		const ydoc = new Y.Doc();
		const idb = new IndexeddbPersistence(roomName, ydoc);
		let ws: WebsocketProvider | null = null;
		let settled = false;
		let hydrationStarted = false;
		let remoteFallbackTimer: number | null = null;
		let loadingTimer: number | null = null;
		let idbFallbackTimer: number | null = null;
		let detachDocObserver: (() => void) | null = null;
		let detachWsSyncObserver: (() => void) | null = null;

		const settle = (): void => {
			if (settled) return;
			settled = true;
			if (loadingTimer != null) window.clearTimeout(loadingTimer);
			if (idbFallbackTimer != null) window.clearTimeout(idbFallbackTimer);
			if (remoteFallbackTimer != null) window.clearTimeout(remoteFallbackTimer);
			detachDocObserver?.();
			detachWsSyncObserver?.();
			providersRef.current = { ydoc, idb, ws };
			setShowLoading(false);
			setDoc(ydoc);
		};

		const settleMissing = (): void => {
			if (settled) return;
			settled = true;
			if (loadingTimer != null) window.clearTimeout(loadingTimer);
			if (idbFallbackTimer != null) window.clearTimeout(idbFallbackTimer);
			if (remoteFallbackTimer != null) window.clearTimeout(remoteFallbackTimer);
			detachDocObserver?.();
			detachWsSyncObserver?.();
			setShowLoading(false);
			onShowBriefDialog?.('This note is no longer available.');
			onClose();
		};

		const beginHydration = (): void => {
			if (hydrationStarted || settled) return;
			hydrationStarted = true;
			// Start websocket sync once local IndexedDB has had a chance to hydrate.
			ws = new WebsocketProvider(websocketUrl, roomName, ydoc, { connect: true });
			providersRef.current = { ydoc, idb, ws };

			if (docHasRenderableContent(ydoc, noteId)) {
				settle();
				return;
			}

			const onDocChange = (): void => {
				if (docHasRenderableContent(ydoc, noteId)) {
					settle();
				}
			};
			ydoc.on('afterTransaction', onDocChange);
			detachDocObserver = () => {
				ydoc.off('afterTransaction', onDocChange);
			};

			const onSync = (isSynced: boolean): void => {
				if (!isSynced) return;
				if (docHasRenderableContent(ydoc, noteId)) {
					settle();
				}
			};
			ws.on('sync', onSync);
			detachWsSyncObserver = () => {
				ws?.off('sync', onSync);
			};

			// Notes with no title/body/checklist rows after initial hydration are ghost
			// entries from stale registry/cache state, not real saved notes.
			remoteFallbackTimer = window.setTimeout(() => {
				if (docHasRenderableContent(ydoc, noteId)) {
					settle();
					return;
				}
				settleMissing();
			}, REMOTE_SYNC_FALLBACK_MS);
		};

		loadingTimer = window.setTimeout(() => {
			setShowLoading(true);
		}, LOADING_INDICATOR_DELAY_MS);

		if ((idb as unknown as { synced: boolean }).synced) {
			beginHydration();
		} else {
			idb.on('synced', beginHydration);
			idbFallbackTimer = window.setTimeout(beginHydration, IDB_HYDRATION_FALLBACK_MS);
		}

		return () => {
			if (loadingTimer != null) window.clearTimeout(loadingTimer);
			if (idbFallbackTimer != null) window.clearTimeout(idbFallbackTimer);
			if (remoteFallbackTimer != null) window.clearTimeout(remoteFallbackTimer);
			detachDocObserver?.();
			detachWsSyncObserver?.();
			settled = true; // Prevent settle from firing after unmount.
			try { idb.destroy(); } catch { /* ignore */ }
			try { ws?.destroy(); } catch { /* ignore */ }
			try { ydoc.destroy(); } catch { /* ignore */ }
			providersRef.current = null;
		};
	}, [docId, noteId, onClose, onShowBriefDialog, websocketUrl]);

	// Close on Escape key.
	React.useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);

	if (doc == null) {
		if (!showLoading) return <></>;
		return (
			<div className={styles.overlay} role="presentation" onClick={onClose}>
				<div className={styles.loadingCard} role="dialog" aria-modal aria-label={`Loading note from ${workspaceName}`} onClick={(e) => e.stopPropagation()}>
					<div className={styles.workspaceTag}>
						<span className={styles.workspaceTagDot} aria-hidden="true" />
						<span className={styles.workspaceTagName}>{workspaceName}</span>
					</div>
					<div className={styles.loading}>Loading…</div>
				</div>
			</div>
		);
	}

	return (
		<NoteEditor
			noteId={noteId}
			docId={docId}
			authUserId={authUserId}
			themeId={themeId}
			doc={doc}
			onClose={onClose}
			onAddCollaborator={onAddCollaborator ? () => onAddCollaborator({ noteId, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onAddImage={onAddImage ? () => onAddImage({ noteId, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onAddDocument={onAddDocument ? () => onAddDocument({ noteId, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onAddReminder={onAddReminder ? () => onAddReminder({ noteId, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onAddToCollection={onAddToCollection ? () => onAddToCollection({ noteId, doc, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onAddLabels={onAddLabels ? () => onAddLabels({ noteId, doc, docId, title: readNoteFromDoc(doc, noteId).title.trim() }) : undefined}
			onShowBriefDialog={onShowBriefDialog}
			readOnly={readOnly}
			initialShowCompleted={initialShowCompleted}
			allowQuickDelete={allowQuickDelete}
			onDelete={async (_deletedNoteId) => {
				// Soft-delete via the Y.Doc so the WS provider syncs the trashed
				// flag to the server. The note will appear in that workspace's trash.
				setNoteTrashed(doc, true);
				onClose();
			}}
			onTogglePin={readOnly ? undefined : () => {
				const isPinned = readNoteMetadataState(doc).isPinned;
				assignNotePinned(doc, !isPinned);
			}}
		/>
	);
}
