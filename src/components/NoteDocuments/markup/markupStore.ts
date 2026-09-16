import React from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import {
	isMarkupUnsynced,
	MARKUP_LOGOUT_EVENT,
	markupDatabaseName,
	rememberMarkupVersion,
	setMarkupUnsynced,
	subscribeMarkupRegistry,
} from '../../../core/markupSync';
import { isMarkup, isMarkupReply, isPageScale, planCommentRenumbering, type CommentMarkup, type Markup, type MarkupReply, type PageScale } from './markupTypes';

// One Yjs doc per document version holds its markup: a map of markup id → plain object, comment
// replies in a map of their own (so two people replying at once both land), and a small "meta" map
// with the comment number counter. Markup stays with the version it was drawn on (D7).
//
// The doc is saved on this device (IndexedDB, same library the notes use) and, once that copy has
// loaded, connected to the server's "markup:<versionId>" room. The server decides who may join and
// who may only read (server/markupRooms.js). Offline, everything keeps working on the device copy
// and merges when the connection comes back; changes made while not synced are flagged in
// core/markupSync.ts so they upload in the background and sign-out can warn about them.

const LOCAL_ORIGIN = Symbol('pdf-markup-local');
// Renumbering duplicate comments after a sync is housekeeping every device does the same way,
// not something to undo.
const RENUMBER_ORIGIN = Symbol('pdf-markup-renumber');
// Closing and reopening the viewer quickly (or React's development double-mount) shouldn't tear
// the doc down and reload it from IndexedDB. Also gives the socket a moment to finish sending.
const RELEASE_DELAY_MS = 1500;
const LAST_COMMENT_NUMBER = 'lastCommentNumber';
const BACKGROUND_SYNC_TIMEOUT_MS = 20_000;
// How long the document list's download menu waits for the server's copy of a version's markup.
const SNAPSHOT_SYNC_TIMEOUT_MS = 6_000;
const MARKUP_ROOM_PREFIX = 'markup:';

/**
 * local: not connecting (no server address yet); connecting: reaching the server or waiting for
 * its copy; synced: up to date with the server; offline: connection lost, retrying; denied: the
 * server refused this room (no access, signed out, or the document was deleted).
 */
export type MarkupSyncState = 'local' | 'connecting' | 'synced' | 'offline' | 'denied';

type MarkupDocHandle = {
	versionId: string;
	doc: Y.Doc;
	items: Y.Map<Markup>;
	replies: Y.Map<MarkupReply>;
	/** Page number (as text) → that page's scale, for measurements. */
	scales: Y.Map<PageScale>;
	meta: Y.Map<unknown>;
	undo: Y.UndoManager;
	persistence: IndexeddbPersistence | null;
	provider: WebsocketProvider | null;
	websocketUrl: string | null;
	ready: boolean;
	whenReady: Promise<void>;
	refs: number;
	/** How many of the current users can edit: only editors renumber duplicate comments. */
	editors: number;
	releaseTimer: ReturnType<typeof setTimeout> | null;
	syncState: MarkupSyncState;
	listeners: Set<() => void>;
	renumberScheduled: boolean;
	destroyed: boolean;
};

const handles = new Map<string, MarkupDocHandle>();

function notify(handle: MarkupDocHandle): void {
	for (const listener of Array.from(handle.listeners)) listener();
}

function setSyncState(handle: MarkupDocHandle, next: MarkupSyncState): void {
	if (handle.syncState === next) return;
	handle.syncState = next;
	notify(handle);
}

/** The comment number counter, or the highest number actually in use if that's somehow higher. */
function nextCommentNumber(handle: MarkupDocHandle): number {
	let highest = Number(handle.meta.get(LAST_COMMENT_NUMBER)) || 0;
	for (const item of handle.items.values()) {
		if (item && item.kind === 'comment' && Number.isFinite(item.number)) highest = Math.max(highest, item.number);
	}
	return highest + 1;
}

function renumberDuplicateComments(handle: MarkupDocHandle): void {
	const comments = Array.from(handle.items.values()).filter(isMarkup).filter((item): item is CommentMarkup => item.kind === 'comment');
	const counter = Number(handle.meta.get(LAST_COMMENT_NUMBER)) || 0;
	const changes = planCommentRenumbering(comments, counter);
	if (changes.length === 0) return;
	handle.doc.transact(() => {
		for (const change of changes) {
			const current = handle.items.get(change.id);
			// updatedAt is left alone so two devices renumbering at once write identical entries.
			if (current && current.kind === 'comment') handle.items.set(change.id, { ...current, number: change.number });
		}
		handle.meta.set(LAST_COMMENT_NUMBER, Math.max(counter, ...changes.map((change) => change.number)));
	}, RENUMBER_ORIGIN);
}

function scheduleRenumber(handle: MarkupDocHandle): void {
	if (handle.renumberScheduled || handle.editors <= 0) return;
	handle.renumberScheduled = true;
	queueMicrotask(() => {
		handle.renumberScheduled = false;
		// Only with the server's full copy in hand; a half-synced doc could "fix" a clash that isn't one.
		if (handle.destroyed || !handle.provider || !handle.provider.synced || handle.editors <= 0) return;
		renumberDuplicateComments(handle);
	});
}

function connectMarkupDoc(handle: MarkupDocHandle): void {
	if (handle.destroyed || handle.provider || !handle.websocketUrl || !handle.ready) return;
	if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'undefined') return;
	// Same settings the note rooms use (DocumentManager): resync every 30 s against silently dropped
	// frames on flaky mobile networks, and a short reconnect backoff.
	const provider = new WebsocketProvider(handle.websocketUrl, `${MARKUP_ROOM_PREFIX}${handle.versionId}`, handle.doc, {
		connect: true,
		resyncInterval: 30_000,
		maxBackoffTime: 5_000,
	});
	handle.provider = provider;
	setSyncState(handle, 'connecting');
	provider.on('status', (event: { status: string }) => {
		if (handle.syncState === 'denied') return;
		if (event.status === 'disconnected') setSyncState(handle, 'offline');
		else if (event.status === 'connected' && !provider.synced) setSyncState(handle, 'connecting');
	});
	provider.on('sync', (synced: boolean) => {
		if (!synced || handle.syncState === 'denied') return;
		setSyncState(handle, 'synced');
		// By now this device's changes have gone to the server in the sync handshake.
		setMarkupUnsynced(handle.versionId, false);
		scheduleRenumber(handle);
	});
	provider.on('connection-close', (event: CloseEvent | null) => {
		// 1008 is the server refusing the room: no access, not signed in, or the document is gone.
		// "read-only" is a viewer's device trying to write, which is only ever a stray change; the
		// provider can reconnect from that one.
		if (event && event.code === 1008 && event.reason !== 'read-only') {
			provider.disconnect();
			setSyncState(handle, 'denied');
			// Nothing waiting here can ever upload, so don't keep warning about it at sign-out.
			setMarkupUnsynced(handle.versionId, false);
		}
	});
}

function destroyHandle(handle: MarkupDocHandle): void {
	if (handle.destroyed) return;
	handle.destroyed = true;
	if (handle.releaseTimer != null) clearTimeout(handle.releaseTimer);
	handle.releaseTimer = null;
	handle.provider?.destroy();
	handle.provider = null;
	handle.undo.destroy();
	void handle.persistence?.destroy();
	handle.doc.destroy();
	notify(handle);
}

function acquireMarkupDoc(versionId: string, options: { websocketUrl: string | null; canEdit: boolean }): MarkupDocHandle {
	const existing = handles.get(versionId);
	if (existing && !existing.destroyed) {
		existing.refs += 1;
		if (options.canEdit) existing.editors += 1;
		if (existing.releaseTimer != null) {
			clearTimeout(existing.releaseTimer);
			existing.releaseTimer = null;
		}
		if (!existing.websocketUrl && options.websocketUrl) {
			existing.websocketUrl = options.websocketUrl;
			connectMarkupDoc(existing);
		}
		return existing;
	}
	const doc = new Y.Doc();
	const items = doc.getMap<Markup>('markups');
	const replies = doc.getMap<MarkupReply>('replies');
	const scales = doc.getMap<PageScale>('scales');
	const meta = doc.getMap<unknown>('meta');
	// captureTimeout 0: every stroke is its own undo step, however quickly you draw the next one.
	// The comment counter (meta) is deliberately not undoable: undoing a new comment must not hand
	// its number to the next one.
	const undo = new Y.UndoManager([items, replies, scales], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 0 });
	let persistence: IndexeddbPersistence | null = null;
	try {
		persistence = new IndexeddbPersistence(markupDatabaseName(versionId), doc);
	} catch {
		// Private browsing with storage blocked: markup still works for this session.
	}
	const handle: MarkupDocHandle = {
		versionId,
		doc,
		items,
		replies,
		scales,
		meta,
		undo,
		persistence,
		provider: null,
		websocketUrl: options.websocketUrl,
		ready: !persistence,
		whenReady: Promise.resolve(),
		refs: 1,
		editors: options.canEdit ? 1 : 0,
		releaseTimer: null,
		syncState: 'local',
		listeners: new Set(),
		renumberScheduled: false,
		destroyed: false,
	};
	handles.set(versionId, handle);
	rememberMarkupVersion(versionId);

	doc.on('update', (_update: Uint8Array, origin: unknown) => {
		if (origin === handle.persistence) return;
		if (origin === handle.provider) {
			// Someone else's markup arrived: maybe a comment number clash with one made here offline.
			scheduleRenumber(handle);
			return;
		}
		// A change made on this device. Connected and synced, it's already on its way to the server.
		const provider = handle.provider;
		if (!provider || !provider.wsconnected || !provider.synced) setMarkupUnsynced(versionId, true);
	});

	// The device copy loads first, then the server connection opens, so offline work is part of the
	// very first sync instead of racing it.
	const markReady = (): void => {
		handle.ready = true;
		connectMarkupDoc(handle);
		notify(handle);
	};
	if (persistence) {
		handle.whenReady = persistence.whenSynced
			.then(() => undefined)
			.catch(() => undefined)
			.finally(markReady);
	} else {
		markReady();
	}
	return handle;
}

function releaseMarkupDoc(versionId: string, canEdit: boolean): void {
	const handle = handles.get(versionId);
	if (!handle || handle.destroyed) return;
	handle.refs -= 1;
	if (canEdit) handle.editors = Math.max(0, handle.editors - 1);
	if (handle.refs > 0) return;
	handle.releaseTimer = setTimeout(() => {
		if (handle.refs > 0) return;
		if (handles.get(versionId) === handle) handles.delete(versionId);
		destroyHandle(handle);
	}, RELEASE_DELAY_MS);
}

// Sign-out: close every open markup doc now, so the IndexedDB deletes in core/markupSync.ts go through.
if (typeof window !== 'undefined') {
	window.addEventListener(MARKUP_LOGOUT_EVENT, () => {
		for (const handle of Array.from(handles.values())) destroyHandle(handle);
		handles.clear();
	});
}

/** What a doc holds right now: markup and replies checked and in the order they were made, plus page scales. */
function readHandleContents(handle: MarkupDocHandle): { items: Markup[]; replies: MarkupReply[]; pageScales: Map<number, PageScale> } {
	const items = Array.from(handle.items.values())
		.filter(isMarkup)
		.sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
	const replies = Array.from(handle.replies.values())
		.filter(isMarkupReply)
		.sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
	const pageScales = new Map<number, PageScale>();
	for (const scale of handle.scales.values()) {
		if (isPageScale(scale)) pageScales.set(scale.page, scale);
	}
	return { items, replies, pageScales };
}

/**
 * One version's markup, read once without opening the viewer (the document list's download menu).
 * The device copy loads first; with a server address and a connection it then waits up to
 * `timeoutMs` for the server's copy too, so markup drawn on another device counts. Offline, refused
 * or slow, it answers with what this device has.
 */
export async function readMarkupSnapshot(
	versionId: string,
	options: { websocketUrl: string | null; timeoutMs?: number },
): Promise<{ items: readonly Markup[]; replies: readonly MarkupReply[]; pageScales: ReadonlyMap<number, PageScale> }> {
	const handle = acquireMarkupDoc(versionId, { websocketUrl: options.websocketUrl, canEdit: false });
	try {
		await handle.whenReady;
		const online = typeof navigator === 'undefined' || navigator.onLine !== false;
		if (options.websocketUrl && online && !handle.destroyed && handle.syncState !== 'synced' && handle.syncState !== 'denied') {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(done, options.timeoutMs ?? SNAPSHOT_SYNC_TIMEOUT_MS);
				function done(): void {
					clearTimeout(timer);
					handle.listeners.delete(check);
					resolve();
				}
				function check(): void {
					if (handle.syncState === 'synced' || handle.syncState === 'denied' || handle.destroyed) done();
				}
				handle.listeners.add(check);
				check();
			});
		}
		return readHandleContents(handle);
	} finally {
		releaseMarkupDoc(versionId, false);
	}
}

/**
 * Background upload of one version's waiting markup (core/markupSync.ts): open the doc from the
 * device copy, let it sync, and close it again. Resolves true once the server has it.
 */
export function syncMarkupVersionInBackground(versionId: string, websocketUrl: string): Promise<boolean> {
	const handle = acquireMarkupDoc(versionId, { websocketUrl, canEdit: false });
	return new Promise((resolve) => {
		let finished = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const finish = (synced: boolean): void => {
			if (finished) return;
			finished = true;
			handle.listeners.delete(check);
			if (timer != null) clearTimeout(timer);
			releaseMarkupDoc(versionId, false);
			resolve(synced);
		};
		function check(): void {
			if (handle.syncState === 'synced') finish(true);
			else if (handle.syncState === 'denied' || handle.destroyed) finish(false);
		}
		handle.listeners.add(check);
		timer = setTimeout(() => finish(false), BACKGROUND_SYNC_TIMEOUT_MS);
		check();
	});
}

export type PdfMarkup = {
	/** Stored markup has loaded (a blank page before this may just mean "not read yet"). */
	ready: boolean;
	items: readonly Markup[];
	/** Replies to comments, oldest first. */
	replies: readonly MarkupReply[];
	canUndo: boolean;
	canRedo: boolean;
	syncState: MarkupSyncState;
	/** This device has changes the server hasn't had yet. */
	unsynced: boolean;
	/** Each page's scale for measurements (pages without one aren't in the map). */
	pageScales: ReadonlyMap<number, PageScale>;
	/** Sets a page's scale, or clears it with null. Undoable, and synced like the markup. */
	setPageScale: (page: number, scale: PageScale | null) => void;
	/** Adds a markup, or replaces the one with the same id (moves, resizes, recolours, text edits). */
	add: (markup: Markup) => void;
	/** Saves a new comment with the next number. Returns it as saved. */
	addComment: (comment: CommentMarkup) => CommentMarkup | null;
	/** The number the next new comment will get. */
	peekCommentNumber: () => number;
	addReply: (reply: MarkupReply) => void;
	removeReply: (replyId: string) => void;
	/** Removes markups (and the replies of any comments among them). */
	removeMany: (ids: readonly string[]) => void;
	undo: () => void;
	redo: () => void;
};

type MarkupSnapshot = Pick<PdfMarkup, 'ready' | 'items' | 'replies' | 'canUndo' | 'canRedo' | 'syncState' | 'unsynced' | 'pageScales'>;

const NO_SCALES: ReadonlyMap<number, PageScale> = new Map();
const EMPTY_SNAPSHOT: MarkupSnapshot = { ready: false, items: [], replies: [], canUndo: false, canRedo: false, syncState: 'local', unsynced: false, pageScales: NO_SCALES };

export function usePdfMarkup(versionId: string | null, options: { websocketUrl: string | null; canEdit: boolean }): PdfMarkup {
	const [snapshot, setSnapshot] = React.useState<MarkupSnapshot>(EMPTY_SNAPSHOT);
	const handleRef = React.useRef<MarkupDocHandle | null>(null);
	const { websocketUrl, canEdit } = options;

	React.useEffect(() => {
		if (!versionId) {
			setSnapshot(EMPTY_SNAPSHOT);
			return;
		}
		const handle = acquireMarkupDoc(versionId, { websocketUrl, canEdit });
		handleRef.current = handle;
		let active = true;
		const publish = (): void => {
			if (!active || handle.destroyed) return;
			const { items, replies, pageScales } = readHandleContents(handle);
			setSnapshot({
				ready: handle.ready,
				items,
				replies,
				pageScales,
				canUndo: handle.undo.canUndo(),
				canRedo: handle.undo.canRedo(),
				syncState: handle.syncState,
				unsynced: isMarkupUnsynced(versionId),
			});
		};
		handle.items.observe(publish);
		handle.replies.observe(publish);
		handle.scales.observe(publish);
		handle.undo.on('stack-item-added', publish);
		handle.undo.on('stack-item-popped', publish);
		handle.undo.on('stack-cleared', publish);
		handle.listeners.add(publish);
		const unsubscribeRegistry = subscribeMarkupRegistry(publish);
		void handle.whenReady.then(publish);
		publish();
		return () => {
			active = false;
			if (!handle.destroyed) {
				handle.items.unobserve(publish);
				handle.replies.unobserve(publish);
				handle.scales.unobserve(publish);
				handle.undo.off('stack-item-added', publish);
				handle.undo.off('stack-item-popped', publish);
				handle.undo.off('stack-cleared', publish);
			}
			handle.listeners.delete(publish);
			unsubscribeRegistry();
			if (handleRef.current === handle) handleRef.current = null;
			releaseMarkupDoc(versionId, canEdit);
		};
	}, [canEdit, versionId, websocketUrl]);

	const add = React.useCallback((markup: Markup): void => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed) return;
		handle.doc.transact(() => handle.items.set(markup.id, markup), LOCAL_ORIGIN);
	}, []);

	const addComment = React.useCallback((comment: CommentMarkup): CommentMarkup | null => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed) return null;
		const saved: CommentMarkup = { ...comment, number: nextCommentNumber(handle) };
		handle.doc.transact(() => {
			handle.meta.set(LAST_COMMENT_NUMBER, saved.number);
			handle.items.set(saved.id, saved);
		}, LOCAL_ORIGIN);
		return saved;
	}, []);

	const peekCommentNumber = React.useCallback((): number => {
		const handle = handleRef.current;
		return handle && !handle.destroyed ? nextCommentNumber(handle) : 1;
	}, []);

	const addReply = React.useCallback((reply: MarkupReply): void => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed) return;
		handle.doc.transact(() => handle.replies.set(reply.id, reply), LOCAL_ORIGIN);
	}, []);

	const removeReply = React.useCallback((replyId: string): void => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed) return;
		handle.doc.transact(() => handle.replies.delete(replyId), LOCAL_ORIGIN);
	}, []);

	const setPageScale = React.useCallback((page: number, scale: PageScale | null): void => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed) return;
		handle.doc.transact(() => {
			if (scale) handle.scales.set(String(page), { ...scale, page });
			else handle.scales.delete(String(page));
		}, LOCAL_ORIGIN);
	}, []);

	const removeMany = React.useCallback((ids: readonly string[]): void => {
		const handle = handleRef.current;
		if (!handle || handle.destroyed || ids.length === 0) return;
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
		const handle = handleRef.current;
		if (handle && !handle.destroyed) handle.undo.undo();
	}, []);

	const redo = React.useCallback((): void => {
		const handle = handleRef.current;
		if (handle && !handle.destroyed) handle.undo.redo();
	}, []);

	return { ...snapshot, add, addComment, peekCommentNumber, addReply, removeReply, removeMany, setPageScale, undo, redo };
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
