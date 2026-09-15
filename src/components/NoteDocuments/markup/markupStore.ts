import React from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isMarkup, isMarkupReply, type CommentMarkup, type Markup, type MarkupReply } from './markupTypes';

// One Yjs doc per document version holds its markup: a map of markup id → plain object.
// Markup stays with the version it was drawn on (D7), so a new version starts clean.
//
// For now the doc lives on this device only (IndexedDB, same library the notes use). Stage 4
// connects the very same doc to the server, so the shape of the data doesn't change when sync
// arrives, and each markup is its own map entry so two people editing different markups merge.
// Comment replies get a map of their own for the same reason, and a small "meta" map keeps the
// comment number counter.

const MARKUP_DB_PREFIX = 'freemannotes-markup:';
const LOCAL_ORIGIN = Symbol('pdf-markup-local');
// Closing and reopening the viewer quickly (or React's development double-mount) shouldn't tear
// the doc down and reload it from IndexedDB.
const RELEASE_DELAY_MS = 1500;
const LAST_COMMENT_NUMBER = 'lastCommentNumber';

type MarkupDocHandle = {
	doc: Y.Doc;
	items: Y.Map<Markup>;
	replies: Y.Map<MarkupReply>;
	meta: Y.Map<unknown>;
	undo: Y.UndoManager;
	persistence: IndexeddbPersistence | null;
	ready: boolean;
	whenReady: Promise<void>;
	refs: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
};

const handles = new Map<string, MarkupDocHandle>();

function acquireMarkupDoc(versionId: string): MarkupDocHandle {
	const existing = handles.get(versionId);
	if (existing) {
		existing.refs += 1;
		if (existing.releaseTimer != null) {
			clearTimeout(existing.releaseTimer);
			existing.releaseTimer = null;
		}
		return existing;
	}
	const doc = new Y.Doc();
	const items = doc.getMap<Markup>('markups');
	const replies = doc.getMap<MarkupReply>('replies');
	const meta = doc.getMap<unknown>('meta');
	// captureTimeout 0: every stroke is its own undo step, however quickly you draw the next one.
	// The comment counter (meta) is deliberately not undoable: undoing a new comment must not hand
	// its number to the next one.
	const undo = new Y.UndoManager([items, replies], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 });
	let persistence: IndexeddbPersistence | null = null;
	try {
		persistence = new IndexeddbPersistence(`${MARKUP_DB_PREFIX}${versionId}`, doc);
	} catch {
		// Private browsing with storage blocked: markup still works for this session.
	}
	const handle: MarkupDocHandle = {
		doc,
		items,
		replies,
		meta,
		undo,
		persistence,
		ready: !persistence,
		whenReady: Promise.resolve(),
		refs: 1,
		releaseTimer: null,
	};
	if (persistence) {
		handle.whenReady = persistence.whenSynced
			.then(() => undefined)
			.catch(() => undefined)
			.finally(() => {
				handle.ready = true;
			});
	}
	handles.set(versionId, handle);
	return handle;
}

function releaseMarkupDoc(versionId: string): void {
	const handle = handles.get(versionId);
	if (!handle) return;
	handle.refs -= 1;
	if (handle.refs > 0) return;
	handle.releaseTimer = setTimeout(() => {
		if (handle.refs > 0) return;
		handles.delete(versionId);
		handle.undo.destroy();
		void handle.persistence?.destroy();
		handle.doc.destroy();
	}, RELEASE_DELAY_MS);
}

/** The counter, or the highest number actually in use if that's somehow higher (belt and braces). */
function nextCommentNumber(handle: MarkupDocHandle): number {
	let highest = Number(handle.meta.get(LAST_COMMENT_NUMBER)) || 0;
	for (const item of handle.items.values()) {
		if (item && item.kind === 'comment' && Number.isFinite(item.number)) highest = Math.max(highest, item.number);
	}
	return highest + 1;
}

export type PdfMarkup = {
	/** Stored markup has loaded (a blank page before this may just mean "not read yet"). */
	ready: boolean;
	items: readonly Markup[];
	/** Replies to comments, oldest first. */
	replies: readonly MarkupReply[];
	canUndo: boolean;
	canRedo: boolean;
	/** Adds a markup, or replaces the one with the same id (moves, resizes, recolours, text edits). */
	add: (markup: Markup) => void;
	/** Saves a new comment with the next number. Returns it as saved. */
	addComment: (comment: CommentMarkup) => CommentMarkup | null;
	/** The number the next new comment will get. */
	peekCommentNumber: () => number;
	addReply: (reply: MarkupReply) => void;
	/** Removes markups (and the replies of any comments among them). */
	removeMany: (ids: readonly string[]) => void;
	undo: () => void;
	redo: () => void;
};

type MarkupSnapshot = Pick<PdfMarkup, 'ready' | 'items' | 'replies' | 'canUndo' | 'canRedo'>;

const EMPTY_SNAPSHOT: MarkupSnapshot = { ready: false, items: [], replies: [], canUndo: false, canRedo: false };

export function usePdfMarkup(versionId: string | null): PdfMarkup {
	const [snapshot, setSnapshot] = React.useState<MarkupSnapshot>(EMPTY_SNAPSHOT);
	const handleRef = React.useRef<MarkupDocHandle | null>(null);

	React.useEffect(() => {
		if (!versionId) {
			setSnapshot(EMPTY_SNAPSHOT);
			return;
		}
		const handle = acquireMarkupDoc(versionId);
		handleRef.current = handle;
		let active = true;
		const publish = (): void => {
			if (!active) return;
			const items = Array.from(handle.items.values())
				.filter(isMarkup)
				.sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
			const replies = Array.from(handle.replies.values())
				.filter(isMarkupReply)
				.sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
			setSnapshot({ ready: handle.ready, items, replies, canUndo: handle.undo.canUndo(), canRedo: handle.undo.canRedo() });
		};
		handle.items.observe(publish);
		handle.replies.observe(publish);
		handle.undo.on('stack-item-added', publish);
		handle.undo.on('stack-item-popped', publish);
		handle.undo.on('stack-cleared', publish);
		void handle.whenReady.then(publish);
		publish();
		return () => {
			active = false;
			handle.items.unobserve(publish);
			handle.replies.unobserve(publish);
			handle.undo.off('stack-item-added', publish);
			handle.undo.off('stack-item-popped', publish);
			handle.undo.off('stack-cleared', publish);
			if (handleRef.current === handle) handleRef.current = null;
			releaseMarkupDoc(versionId);
		};
	}, [versionId]);

	const add = React.useCallback((markup: Markup): void => {
		const handle = handleRef.current;
		if (!handle) return;
		handle.doc.transact(() => handle.items.set(markup.id, markup), LOCAL_ORIGIN);
	}, []);

	const addComment = React.useCallback((comment: CommentMarkup): CommentMarkup | null => {
		const handle = handleRef.current;
		if (!handle) return null;
		const saved: CommentMarkup = { ...comment, number: nextCommentNumber(handle) };
		handle.doc.transact(() => {
			handle.meta.set(LAST_COMMENT_NUMBER, saved.number);
			handle.items.set(saved.id, saved);
		}, LOCAL_ORIGIN);
		return saved;
	}, []);

	const peekCommentNumber = React.useCallback((): number => {
		const handle = handleRef.current;
		return handle ? nextCommentNumber(handle) : 1;
	}, []);

	const addReply = React.useCallback((reply: MarkupReply): void => {
		const handle = handleRef.current;
		if (!handle) return;
		handle.doc.transact(() => handle.replies.set(reply.id, reply), LOCAL_ORIGIN);
	}, []);

	const removeMany = React.useCallback((ids: readonly string[]): void => {
		const handle = handleRef.current;
		if (!handle || ids.length === 0) return;
		const removed = new Set(ids);
		// One transaction, so an eraser swipe across five markups is one undo step.
		handle.doc.transact(() => {
			for (const id of ids) handle.items.delete(id);
			for (const [replyId, reply] of handle.replies.entries()) {
				if (reply && removed.has(reply.commentId)) handle.replies.delete(replyId);
			}
		}, LOCAL_ORIGIN);
	}, []);

	const undo = React.useCallback((): void => {
		handleRef.current?.undo.undo();
	}, []);

	const redo = React.useCallback((): void => {
		handleRef.current?.undo.redo();
	}, []);

	return { ...snapshot, add, addComment, peekCommentNumber, addReply, removeMany, undo, redo };
}

/** The shape being drawn right now. Kept out of React state so a stroke doesn't re-render the viewer. */
export type MarkupDraftStore = {
	get: () => Markup | null;
	set: (next: Markup | null) => void;
	subscribe: (listener: () => void) => () => void;
};

export function createMarkupDraftStore(): MarkupDraftStore {
	let current: Markup | null = null;
	const listeners = new Set<() => void>();
	return {
		get: () => current,
		set: (next) => {
			if (next === current) return;
			current = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
