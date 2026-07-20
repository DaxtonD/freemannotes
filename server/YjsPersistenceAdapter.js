'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// YjsPersistenceAdapter – server-side Yjs document persistence via PostgreSQL.
//
// Phase 10: PostgreSQL is the canonical source of truth for all document state.
// Yjs in-memory docs are ephemeral runtime state only. Redis remains a cache.
//
// This adapter plugs into y-websocket's `setupWSConnection` persistence
// callback interface. It provides two main operations:
//
//   1. **bindState(docName, yDoc)** — called when a Yjs room is first opened
//      by a WebSocket client. It loads the stored binary state from PostgreSQL
//      (or Redis cache, if available) and applies it to the in-memory Y.Doc.
//
//   2. **writeState(docName, yDoc)** — called when the last client disconnects
//      from a room. It serializes the full doc state and writes it to PostgreSQL
//      (and refreshes the Redis cache).
//
// Additionally, a **debounced auto-save** runs every DEBOUNCE_MS milliseconds
// while a doc is actively being edited, ensuring periodic durable writes even
// before the last client disconnects.
//
// All operations are workspace-scoped. The workspace ID is resolved once at
// adapter construction time (or lazily on first use) and used for all
// subsequent reads/writes.
//
// Dependencies:
//   - @prisma/client (PostgreSQL ORM)
//   - yjs (Y.Doc, Y.encodeStateAsUpdate, Y.applyUpdate, etc.)
//   - ioredis (optional — only instantiated when REDIS_URL is set)
// ─────────────────────────────────────────────────────────────────────────────

const Y = require('yjs');
const { logEvent, getRoomDebugContext } = require('./debugLogger');
const { extractEntityReferences } = require('./extractEntityReferences.cjs');
const { emitActivity } = require('./activityEmitter');

/** XmlFragment key for rich-text note content. Must match richText.ts TEXT_NOTE_RICH_FIELD. */
const RICH_TEXT_FRAGMENT_KEY = 'contentRich';
/** Yjs room suffix for registry docs — skip reference extraction for these. */
const REGISTRY_SUFFIX_RE = /^__|__$/;

// ─── Configuration constants ────────────────────────────────────────────────

/** How often (ms) to auto-persist dirty docs while clients are connected. */
const DEBOUNCE_MS = 5000;

/** Default workspace name created on first boot if none exists. */
const DEFAULT_WORKSPACE_NAME = 'default';

/**
 * Maximum time (ms) to wait for a Redis operation before giving up.
 * Since maxRetriesPerRequest is null (commands queue forever), we apply our
 * own timeout so persistence is never blocked by an unreachable Redis.
 */
const REDIS_TIMEOUT_MS = 3000;

// ─── XML fragment walker (reference extraction) ─────────────────────────────

/**
 * Walks a Y.XmlFragment and returns all Reference nodes (atom inline elements
 * stored by y-prosemirror for the TipTap `reference` node type).
 *
 * y-prosemirror serializes ProseMirror nodes as Y.XmlElement with the node's
 * type name as the tag name and ProseMirror attrs as XML attributes.
 *
 * @param {import('yjs').XmlFragment} fragment
 * @returns {{ nodeId: string, targetType: string, targetId: string, label: string }[]}
 */
/**
 * Walks a Y.XmlFragment collecting reference nodes.
 * Each result includes a `listContext` field indicating whether the reference
 * sits inside a task/list item — used to distinguish assignments from mentions.
 *
 * @param {import('yjs').XmlFragment} fragment
 * @returns {{ nodeId: string, targetType: string, targetId: string, label: string, listContext: 'taskItem'|'listItem'|null }[]}
 */
const _BLOCK_NODE_NAMES = new Set(['paragraph', 'heading', 'taskItem', 'listItem', 'blockquote']);

/**
 * Extract plain text from a Yjs node, substituting reference atoms with "@label".
 * Uses toDelta() on XmlText to avoid mark-formatting artifacts (e.g. <strike>).
 */
function _getPlainText(node) {
	if (node instanceof Y.XmlText) {
		try {
			return node.toDelta().reduce((acc, op) => {
				return acc + (typeof op.insert === 'string' ? op.insert : '');
			}, '');
		} catch {
			return node.toString();
		}
	}
	if (node instanceof Y.XmlElement) {
		if (node.nodeName === 'reference') return `@${node.getAttribute('label') || ''}`;
		if (node.nodeName === 'hardBreak') return '\n';
		return node.toArray().map(_getPlainText).join('');
	}
	return '';
}

/**
 * Walk a Y.XmlFragment and return all reference nodes found.
 * Each result includes nodeId, targetType, targetId, label, listContext, editRole, and excerpt.
 * The excerpt uses the text immediately BEFORE the reference within the same block,
 * so long paragraphs with mentions at the end show useful context rather than the start.
 */
function _walkXmlFragmentForReferences(fragment) {
	const refs = [];

	function walk(node, context) {
		if (!(node instanceof Y.XmlElement)) return;
		const name = node.nodeName;

		let childContext = context;
		if (name === 'taskItem') childContext = 'taskItem';
		else if (name === 'listItem') childContext = 'listItem';

		if (_BLOCK_NODE_NAMES.has(name)) {
			// Walk this block's inline children in order, accumulating text before each reference.
			let textBefore = '';
			for (const child of node.toArray()) {
				if (child instanceof Y.XmlElement && child.nodeName === 'reference') {
					const nodeId = child.getAttribute('nodeId') || child.getAttribute('nodeid') || '';
					const targetType = child.getAttribute('type') || '';
					const targetId = child.getAttribute('id') || '';
					const label = child.getAttribute('label') || '';
					const editRole = child.getAttribute('editRole') || child.getAttribute('editrole') || 'EDITOR';
					// Excerpt = last ≤200 chars of block text before this reference
					const trimmed = textBefore.trim();
					const excerpt = trimmed.length > 0 ? trimmed.slice(-200) : null;
					if (nodeId && targetId && (targetType === 'note' || targetType === 'user')) {
						refs.push({ nodeId, targetType, targetId, label, listContext: childContext, editRole, excerpt });
					}
					textBefore += `@${label}`;
				} else if (child instanceof Y.XmlElement && _BLOCK_NODE_NAMES.has(child.nodeName)) {
					// Nested block (e.g. listItem inside a blockquote)
					walk(child, childContext);
				} else {
					textBefore += _getPlainText(child);
				}
			}
		} else {
			// Non-block container (doc, bulletList, orderedList, etc.): recurse into children.
			for (const child of node.toArray()) walk(child, childContext);
		}
	}

	for (const child of fragment.toArray()) walk(child, null);
	return refs;
}

/**
 * Walk all checklist item rich-content fragments in the doc and collect references.
 * Checklist items are stored as Y.Map inside a Y.Array at key 'checklist'.
 * Each item's rich content is a Y.XmlFragment at key 'contentRich'.
 */
function _walkChecklistForReferences(yDoc) {
	const refs = [];
	try {
		const items = yDoc.getArray('checklist');
		if (!items || items.length === 0) return refs;
		for (const item of items.toArray()) {
			if (!item || typeof item.get !== 'function') continue;
			const fragment = item.get('contentRich');
			if (!(fragment instanceof Y.XmlFragment)) continue;
			const itemRefs = _walkXmlFragmentForReferences(fragment);
			// Fall back to the plain-text 'text' field as the excerpt if the rich
			// walker did not capture block context (top-level fragment nodes)
			const itemText = String(item.get('text') || '').trim().slice(0, 200) || null;
			for (const ref of itemRefs) {
				refs.push({ ...ref, excerpt: ref.excerpt || itemText, listContext: 'taskItem' });
			}
		}
	} catch {
		// non-fatal — continue without checklist refs
	}
	return refs;
}

// ─── Adapter class ──────────────────────────────────────────────────────────

/**
 * Wraps a Redis promise with a timeout. If the operation doesn't complete
 * within `ms` milliseconds, the returned promise rejects with a timeout error.
 * This prevents the server from hanging when Redis is unreachable and commands
 * are queued indefinitely in the ioredis offline queue.
 *
 * @template T
 * @param {Promise<T>} promise — Redis command promise.
 * @param {number} ms — Timeout in milliseconds.
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('Redis operation timed out')), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class YjsPersistenceAdapter {
	/**
	 * @param {import('@prisma/client').PrismaClient} prisma — Prisma client instance.
	 * @param {object} [options]
	 * @param {import('ioredis').Redis | null} [options.redis] — Optional ioredis instance.
	 * @param {string} [options.workspaceName] — Workspace name (default: "default").
	 * @param {number} [options.debounceMs] — Auto-save interval in ms (default: 2000).
	 */
	constructor(prisma, options = {}) {
		/** @type {import('@prisma/client').PrismaClient} */
		this._prisma = prisma;

		/** @type {import('ioredis').Redis | null} */
		this._redis = options.redis || null;

		/** @type {string} */
		this._workspaceName = options.workspaceName || DEFAULT_WORKSPACE_NAME;

		/** @type {number} */
		this._debounceMs = options.debounceMs ?? DEBOUNCE_MS;

		/**
		 * Cached workspace ID (UUID). Resolved lazily on first use via
		 * _ensureWorkspace(). Once resolved, all subsequent calls skip the DB lookup.
		 * @type {string | null}
		 */
		this._workspaceId = null;
		/**
		 * Per-room workspace mapping. Populated by the WebSocket auth layer
		 * before calling setupWSConnection so persistence always writes into
		 * the correct tenant.
		 * @type {Map<string, string>}
		 */
		this._docWorkspaceId = new Map();

		/**
		 * Debounce timers for auto-persistence. Keyed by Yjs room name (docName).
		 * Each timer flushes the current doc state to PostgreSQL after DEBOUNCE_MS
		 * of inactivity (reset on every incoming update).
		 * @type {Map<string, ReturnType<typeof setTimeout>>}
		 */
		this._debounceTimers = new Map();

		/**
		 * Tracks Y.Doc instances that have been bound (loaded from DB) and are
		 * currently active in memory. Used by the debounce-flush logic to access
		 * the doc when the timer fires.
		 * @type {Map<string, import('yjs').Doc>}
		 */
		this._activeDocs = new Map();

		/**
		 * Last persisted state vector per room. Used to skip no-op writes when
		 * open/close lifecycle hooks fire without semantic document changes.
		 * @type {Map<string, Buffer>}
		 */
		this._lastPersistedStateVector = new Map();

		/**
		 * Last known actor (userId) per room. Set by recordDocUpdate() when a WS
		 * client sends an update. Used to attribute mention activities to the correct
		 * user. Best-effort: in multi-user sessions this will be the last writer.
		 * @type {Map<string, string>}
		 */
		this._docActors = new Map();

		/**
		 * Mention notifications deferred until the last client disconnects from the
		 * room. Keyed by docName → nodeId → mention payload. Mentions that are added
		 * and then removed before the editor closes never leave this map and therefore
		 * never produce an activity, inbox card, or push notification.
		 * @type {Map<string, Map<string, object>>}
		 */
		this._pendingMentionNotifications = new Map();

		/**
		 * Optional callback fired after an activity is successfully emitted. Receives
		 * the list of target user IDs so the caller can push a real-time notification
		 * (e.g. via the workspace metadata WS channel).
		 * @type {((payload: { targetUserIds: string[] }) => void) | null}
		 */
		this._onActivityEmitted = typeof options.onActivityEmitted === 'function'
			? options.onActivityEmitted
			: null;

		/**
		 * Optional async callback fired after a mention invitation is created
		 * (non-access users only). Kept for legacy compatibility.
		 * @type {((payload: { targetUserId: string; actorId: string | null; docId: string; noteTitle: string | null; mentionExcerpt: string | null; editRole: string }) => Promise<void>) | null}
		 */
		this._onMentionInvitationCreated = typeof options.onMentionInvitationCreated === 'function'
			? options.onMentionInvitationCreated
			: null;
		/**
		 * Optional async callback fired after any mention activity is emitted,
		 * regardless of whether the target already has access. Used to send push
		 * notifications to all mentioned users (including existing collaborators).
		 * @type {((payload: { targetUserId: string; actorId: string | null; docId: string; noteTitle: string | null; mentionExcerpt: string | null; editRole: string }) => Promise<void>) | null}
		 */
		this._onMentionNotification = typeof options.onMentionNotification === 'function'
			? options.onMentionNotification
			: null;
		/** @type {((payload: { revokedUserIds: string[] }) => void) | null} */
		this._onMentionRevoked = typeof options.onMentionRevoked === 'function'
			? options.onMentionRevoked
			: null;
	}

	/**
	 * Record the userId of the most recent update sender for a room.
	 * Called from the WebSocket message handler before scheduling a debounced write.
	 *
	 * @param {string} docName
	 * @param {string} userId
	 */
	recordDocUpdate(docName, userId) {
		if (docName && userId) this._docActors.set(docName, userId);
	}

	// ─── Public API (y-websocket persistence interface) ───────────────────────

	/**
	 * Called by y-websocket when the first client connects to a room.
	 * Loads the persisted binary state from PostgreSQL (or Redis cache) and
	 * applies it to the provided Y.Doc. Also registers a debounced update
	 * listener for automatic periodic persistence.
	 *
	 * @param {string} docName — Yjs room name (e.g. noteId or "__notes_registry__").
	 * @param {import('yjs').Doc} yDoc — The in-memory Yjs document to hydrate.
	 * @returns {Promise<void>}
	 */
	async bindState(docName, yDoc) {
		const workspaceId = await this._workspaceIdForDocName(docName);

		// Track the active doc for debounced writes.
		this._activeDocs.set(docName, yDoc);

		// ── Attempt Redis cache load first (fast path) ───────────────────────
		logEvent('YJS_BIND_STATE', { ...getRoomDebugContext(docName), event: 'bind-start' });

		let loaded = false;
		if (this._redis) {
			try {
				const cached = await withTimeout(
					this._redis.getBuffer(this._redisKey(docName, workspaceId)),
					REDIS_TIMEOUT_MS
				);
				if (cached && cached.length > 0) {
					Y.applyUpdate(yDoc, new Uint8Array(cached));
					loaded = true;
					logEvent('YJS_BIND_STATE', { ...getRoomDebugContext(docName), event: 'redis-cache-hit', bytes: cached.length });
					console.info(`[persist] loaded from Redis cache: room=${docName}`);
				}
			} catch (err) {
				// Redis failure is non-fatal — fall through to PostgreSQL.
				console.warn(`[persist] Redis read failed for room=${docName}:`, err.message);
			}
		}

		// ── PostgreSQL load (authoritative source) ───────────────────────────
		if (!loaded) {
			try {
				// PostgreSQL is the authoritative source of truth; Redis is just a cache.
				// Multi-tenant: always scope reads to the authenticated workspace.
				let row = await this._prisma.document.findFirst({
					where: { docId: docName, workspaceId },
					select: { id: true, state: true, stateVector: true, docId: true },
				});

				// Backward-compat: legacy installs stored un-namespaced docIds.
				// If the current docName looks like "<workspaceId>:<rawDocId>" and no
				// row exists yet, attempt to load the rawDocId and migrate it in-place.
				if (!row) {
					const idx = docName.indexOf(':');
					if (idx > 0) {
						// Backward-compat: earlier builds accidentally double-namespaced room IDs
						// ("<ws>:<ws>:<docId>"). If a row exists under the double-id, migrate it
						// to the canonical single-namespaced id.
						const doubleDocId = `${workspaceId}:${docName}`;
						const double = await this._prisma.document.findFirst({
							where: { docId: doubleDocId, workspaceId },
							select: { id: true, state: true, stateVector: true },
						});
						if (double && double.state && double.state.length > 0) {
							try {
								await this._prisma.document.update({
									where: { id: double.id },
									data: { docId: docName },
								});
								row = { id: double.id, state: double.state, stateVector: double.stateVector, docId: docName };
								console.info(`[persist] migrated double docId: ${doubleDocId} -> ${docName}`);
							} catch {
								// If it can't be migrated (unique constraint), ignore and fall through.
							}
						}

						const legacyDocId = docName.slice(idx + 1);
						if (legacyDocId) {
							const legacy = await this._prisma.document.findFirst({
								where: { docId: legacyDocId, workspaceId },
								select: { id: true, state: true, stateVector: true },
							});
							if (legacy && legacy.state && legacy.state.length > 0) {
								// Migrate by renaming docId to the namespaced value.
								await this._prisma.document.update({
									where: { id: legacy.id },
									data: { docId: docName },
								});
								row = { id: legacy.id, state: legacy.state, stateVector: legacy.stateVector, docId: docName };
								console.info(`[persist] migrated legacy docId: ${legacyDocId} -> ${docName}`);
							}
						}
					}
				}
				if (row && row.state && row.state.length > 0) {
					Y.applyUpdate(yDoc, new Uint8Array(row.state));
					if (row.stateVector && row.stateVector.length > 0) {
						this._lastPersistedStateVector.set(docName, Buffer.from(row.stateVector));
					}
					loaded = true;
					logEvent('YJS_BIND_STATE', { ...getRoomDebugContext(docName), event: 'db-read', bytes: row.state.length });
					console.info(`[persist] loaded from PostgreSQL: room=${docName} bytes=${row.state.length}`);

					// Warm the Redis cache so subsequent loads are faster.
					if (this._redis) {
						this._cacheToRedis(docName, workspaceId, row.state).catch(() => {});
					}
				}
			} catch (err) {
				console.error(`[persist] PostgreSQL read failed for room=${docName}:`, err.message);
				// Do not throw — let the doc start empty and sync from clients.
			}
		}

		if (!loaded) {
			logEvent('YJS_BIND_STATE', { ...getRoomDebugContext(docName), event: 'hydrate-miss' });
			console.info(`[persist] no stored state for room=${docName} workspaceId=${workspaceId} — starting fresh`);
		}

		logEvent('YJS_BIND_STATE', { ...getRoomDebugContext(docName), event: 'bind-end', loaded });

		// ── Register debounced update listener ───────────────────────────────
		// Every time the doc is modified, reset the debounce timer. When it
		// fires, the current state is flushed to PostgreSQL + Redis.
		const onUpdate = (_update, _origin) => {
			logEvent('YJS_UPDATE', {
				...getRoomDebugContext(docName),
				event: 'server-doc-update',
				updateBytes: _update ? _update.length ?? _update.byteLength ?? 0 : 0,
				origin: _origin != null ? String(_origin) : null,
			});
			this._scheduleDebouncedWrite(docName);
		};
		yDoc.on('update', onUpdate);

		// Store cleanup reference so writeState can detach the listener.
		yDoc.__fnPersistCleanup = () => {
			yDoc.off('update', onUpdate);
		};
	}

	/**
	 * Called by y-websocket when the last client disconnects from a room.
	 * Performs a final flush of the doc state to PostgreSQL + Redis, cancels
	 * any pending debounce timer, and removes the doc from the active set.
	 *
	 * @param {string} docName — Yjs room name.
	 * @param {import('yjs').Doc} yDoc — The in-memory Yjs document to persist.
	 * @returns {Promise<void>}
	 */
	async writeState(docName, yDoc) {
		// Cancel any pending debounce — we'll write immediately.
		this._clearDebounce(docName);

		// Detach the update listener registered in bindState.
		if (typeof yDoc.__fnPersistCleanup === 'function') {
			yDoc.__fnPersistCleanup();
			delete yDoc.__fnPersistCleanup;
		}

		// Flush to durable storage.
		await this._persistDoc(docName, yDoc);

		// _persistDoc fires _syncEntityReferences fire-and-forget so it never
		// delays document saves. For the final disconnect write we need the ref
		// sync fully committed before flushing notifications, so we await it
		// explicitly here. The call is idempotent — if the debounced write already
		// ran, added/removed sets are both empty and it returns immediately.
		const _finalWorkspaceId = this._docWorkspaceId.get(docName);
		if (_finalWorkspaceId) {
			await this._syncEntityReferences(docName, yDoc, _finalWorkspaceId).catch((err) => {
				console.warn('[references] final ref sync failed:', err.message);
			});
		}

		// Fire all mention notifications that were deferred during this editing
		// session. Must run before _docWorkspaceId is cleaned up.
		await this._flushPendingMentionNotifications(docName, yDoc).catch((err) => {
			console.warn('[references] flush pending notifications failed:', err.message);
		});

		// Remove from active tracking.
		this._activeDocs.delete(docName);
		this._docWorkspaceId.delete(docName);
		this._lastPersistedStateVector.delete(docName);
	}

	/**
	 * Registers a workspaceId for a given Yjs room name.
	 * Call this before setupWSConnection so bindState/writeState are scoped.
	 *
	 * @param {string} docName
	 * @param {string} workspaceId
	 */
	registerDocWorkspace(docName, workspaceId) {
		if (!docName || !workspaceId) return;
		this._docWorkspaceId.set(docName, workspaceId);
	}

	// ─── Workspace management ─────────────────────────────────────────────────

	/**
	 * Ensures the target workspace exists in PostgreSQL and returns its UUID.
	 * On first call, creates the workspace row if it doesn't exist yet
	 * (idempotent upsert). Subsequent calls return the cached ID immediately.
	 *
	 * @returns {Promise<string>} Workspace UUID.
	 */
	async _ensureWorkspace() {
		if (this._workspaceId) return this._workspaceId;

		// Upsert: create if missing, return existing if already present.
		const workspace = await this._prisma.workspace.upsert({
			where: { name: this._workspaceName },
			update: {},
			create: { name: this._workspaceName },
			select: { id: true },
		});

		this._workspaceId = workspace.id;
		console.info(`[persist] workspace="${this._workspaceName}" id=${this._workspaceId}`);
		return this._workspaceId;
	}

	/**
	 * Resolves workspaceId for a given docName.
	 *
	 * Multi-tenant mode: the WebSocket auth layer registers a workspaceId.
	 * Legacy mode: falls back to the adapter's single configured workspace.
	 *
	 * @param {string} docName
	 */
	async _workspaceIdForDocName(docName) {
		const mapped = this._docWorkspaceId.get(docName);
		if (mapped) return mapped;
		return this._ensureWorkspace();
	}

	/**
	 * Returns the resolved workspace ID (or null if not yet resolved).
	 * Useful for REST endpoints that need the workspace UUID.
	 *
	 * @returns {string | null}
	 */
	getWorkspaceId() {
		return this._workspaceId;
	}

	// ─── Core persistence logic ───────────────────────────────────────────────

	/**
	 * Serializes the Y.Doc to binary and writes it to PostgreSQL (upsert).
	 * Also refreshes the Redis cache if available.
	 *
	 * @param {string} docName — Yjs room name.
	 * @param {import('yjs').Doc} yDoc — The document to persist.
	 * @returns {Promise<void>}
	 */
	async _persistDoc(docName, yDoc) {
		const workspaceId = await this._workspaceIdForDocName(docName);

		// Encode the full document state as a single binary blob.
		const state = Buffer.from(Y.encodeStateAsUpdate(yDoc));
		const stateVector = Buffer.from(Y.encodeStateVector(yDoc));
		const previousStateVector = this._lastPersistedStateVector.get(docName);
		if (previousStateVector && previousStateVector.equals(stateVector)) {
			logEvent('YJS_PERSIST', { ...getRoomDebugContext(docName), event: 'skip-noop', bytes: state.length });
			return;
		}

		try {
			// Single upsert eliminates the separate findUnique pre-check.
			// The unique constraint on docId prevents duplicates. The update
			// path only touches state/stateVector. If the document belongs to
			// a different workspace (shouldn't happen in normal usage), the
			// workspaceId column keeps its original value and the state is
			// still safely updated — the cross-workspace scenario is a bug
			// in room registration, not a security boundary.
			await this._prisma.document.upsert({
				where: { docId: docName },
				update: { state, stateVector },
				create: { workspaceId, docId: docName, state, stateVector },
			});
			logEvent('YJS_PERSIST', { ...getRoomDebugContext(docName), event: 'db-upsert', bytes: state.length });
			this._lastPersistedStateVector.set(docName, Buffer.from(stateVector));
			console.info(`[persist] saved to PostgreSQL: room=${docName} bytes=${state.length}`);

			// Best-effort entity reference sync (mention detection). Runs after the
			// primary persist so it never blocks or rolls back document saves.
			this._syncEntityReferences(docName, yDoc, workspaceId).catch(() => {});
		} catch (err) {
			console.error(`[persist] PostgreSQL write failed for room=${docName}:`, err.message);
			// Non-fatal: the doc is still in memory and will be retried on next debounce.
		}

		// Refresh Redis cache (best-effort, non-blocking).
		if (this._redis) {
			this._cacheToRedis(docName, workspaceId, state).catch(() => {});
		}
	}

	// ─── Redis helpers ────────────────────────────────────────────────────────

	/**
	 * Constructs the Redis key for a given doc room name.
	 * Namespaced under `fn:yjs:<workspaceName>:<docName>`.
	 *
	 * @param {string} docName — Yjs room name.
	 * @returns {string} Redis key string.
	 */
	_redisKey(docName, workspaceId) {
		return `fn:yjs:${workspaceId || this._workspaceName}:${docName}`;
	}

	/**
	 * Writes doc state to Redis with a 24-hour TTL.
	 * This is a best-effort cache — failure is logged but does not propagate.
	 *
	 * @param {string} docName — Yjs room name.
	 * @param {Buffer | Uint8Array} state — Binary doc state.
	 * @returns {Promise<void>}
	 */
	async _cacheToRedis(docName, workspaceId, state) {
		try {
			const key = this._redisKey(docName, workspaceId);
			// Store with 24-hour TTL. The TTL is a safety net — active docs are
			// refreshed on every debounced write, so the cache stays warm.
			await withTimeout(
				this._redis.set(key, Buffer.from(state), 'EX', 86400),
				REDIS_TIMEOUT_MS
			);
		} catch (err) {
			console.warn(`[persist] Redis write failed for room=${docName}:`, err.message);
		}
	}

	// ─── Entity reference sync ───────────────────────────────────────────────

	/**
	 * Extracts Reference nodes from the Yjs doc's XmlFragment, diffs against the
	 * EntityReference table, and emits mention activities for newly-added user
	 * references. Best-effort: exceptions are caught and logged, never propagated.
	 *
	 * Only runs for note docs (docName = "<workspaceId>:<noteId>"). Registry docs
	 * and docs whose noteId starts/ends with "__" are skipped.
	 *
	 * @param {string} docName
	 * @param {import('yjs').Doc} yDoc
	 * @param {string} workspaceId
	 */
	async _syncEntityReferences(docName, yDoc, workspaceId) {
		try {
			// Only process note docs, not registry docs.
			const colonIdx = docName.indexOf(':');
			if (colonIdx < 1) return;
			const noteId = docName.slice(colonIdx + 1);
			if (REGISTRY_SUFFIX_RE.test(noteId)) return;

			// Skip activity emission for pending-new drafts. The flag is cleared when
			// the user saves the note, at which point this handler will run again and
			// process any mentions that were added during the draft session.
			if (yDoc.getMap('metadata').get('pendingNew') === true) return;

			// Collect references from both the rich-text fragment and checklist items.
			const fragment = yDoc.getXmlFragment(RICH_TEXT_FRAGMENT_KEY);
			const richRefs = _walkXmlFragmentForReferences(fragment);
			const checklistRefs = _walkChecklistForReferences(yDoc);
			const freshRefs = [...richRefs, ...checklistRefs];

			// Load previously stored references for this doc.
			const stored = await this._prisma.entityReference.findMany({
				where: { sourceDocId: docName },
				select: { nodeId: true, targetType: true, targetId: true },
			});
			const storedByNodeId = new Map(stored.map((r) => [r.nodeId, r]));
			const freshByNodeId = new Map(freshRefs.map((r) => [r.nodeId, r]));

			// Compute added and removed sets.
			const added = freshRefs.filter((r) => !storedByNodeId.has(r.nodeId));
			const removedRefs = stored.filter((r) => !freshByNodeId.has(r.nodeId));
			const removedNodeIds = removedRefs.map((r) => r.nodeId);
			const removedUserRefs = removedRefs.filter((r) => r.targetType === 'user');

			// Nothing changed — skip all DB writes.
			if (added.length === 0 && removedNodeIds.length === 0) return;

			// Delete removed references.
			if (removedNodeIds.length > 0) {
				await this._prisma.entityReference.deleteMany({
					where: { sourceDocId: docName, nodeId: { in: removedNodeIds } },
				});

				if (removedUserRefs.length > 0) {
					// Cancel any pending (un-emitted) notifications for the removed refs.
					// These were added and then removed within the same editing session, so
					// no activity was ever emitted — nothing to revoke or archive.
					const pendingForDoc = this._pendingMentionNotifications.get(docName);
					const cancelledNodeIds = new Set();
					if (pendingForDoc) {
						for (const r of removedUserRefs) {
							if (pendingForDoc.has(r.nodeId)) {
								pendingForDoc.delete(r.nodeId);
								cancelledNodeIds.add(r.nodeId);
							}
						}
					}

					// Only revoke invitations and archive activities for mentions that were
					// already emitted in a prior editing session (not pending in this one).
					const emittedRemovedUserTargetIds = removedUserRefs
						.filter((r) => !cancelledNodeIds.has(r.nodeId))
						.map((r) => r.targetId);

					if (emittedRemovedUserTargetIds.length > 0) {
						await this._prisma.noteShareInvitation.updateMany({
							where: {
								docId: docName,
								inviteeUserId: { in: emittedRemovedUserTargetIds },
								source: 'mention',
								status: 'PENDING',
							},
							data: { status: 'REVOKED', revokedAt: new Date() },
						}).catch((err) => {
							console.warn(`[references] mention invitation revoke failed for ${docName}:`, err.message);
						});

						// Archive the inbox activity for removed users so the card disappears
						// regardless of whether the invitation was already accepted.
						try {
							const activitiesToArchive = await this._prisma.activity.findMany({
								where: {
									kind: 'mention',
									sourceDocId: docName,
									targets: { some: { userId: { in: emittedRemovedUserTargetIds } } },
								},
								include: {
									targets: {
										where: { userId: { in: emittedRemovedUserTargetIds } },
										select: { userId: true },
									},
								},
							});
							if (activitiesToArchive.length > 0) {
								const now = new Date();
								await this._prisma.$transaction(
									activitiesToArchive.flatMap((a) =>
										a.targets.map((t) =>
											this._prisma.activityRead.upsert({
												where: { userId_activityId: { userId: t.userId, activityId: a.id } },
												update: { archived: true, archivedAt: now },
												create: { userId: t.userId, activityId: a.id, archived: true, archivedAt: now },
											})
										)
									)
								);
							}
						} catch (err) {
							console.warn(`[references] mention activity archive failed for ${docName}:`, err.message);
						}

						this._onMentionRevoked?.({ revokedUserIds: emittedRemovedUserTargetIds });
					}
				}
			}

			// Upsert added references into EntityReference for deduplication tracking.
			if (added.length > 0) {
				await this._prisma.entityReference.createMany({
					data: added.map((r) => ({
						sourceDocId: docName,
						sourceWorkspaceId: workspaceId,
						sourceNoteId: noteId,
						targetType: r.targetType,
						targetId: r.targetId,
						nodeId: r.nodeId,
					})),
					skipDuplicates: true,
				});
			}

			// Queue newly-added user references into the pending map. Activities,
			// invitations, and push notifications are deferred until the last client
			// disconnects (writeState) so that mentions typed and immediately removed
			// within the same editing session never produce a notification.
			const newUserRefs = added.filter((r) => r.targetType === 'user');
			if (newUserRefs.length === 0) return;

			const actorId = this._docActors.get(docName) ?? null;

			// Determine which new mentions belong to users who already have access
			// to THIS note (workspace members or direct note collaborators).
			const targetUserIds = newUserRefs.map((r) => r.targetId);
			const [members, directCollaborators] = await Promise.all([
				this._prisma.workspaceMember.findMany({
					where: { workspaceId, userId: { in: targetUserIds } },
					select: { userId: true },
				}),
				this._prisma.noteCollaborator.findMany({
					where: { docId: docName, userId: { in: targetUserIds }, revokedAt: null },
					select: { userId: true },
				}),
			]);
			const hasAccessSet = new Set([
				...members.map((m) => m.userId),
				...directCollaborators.map((c) => c.userId),
			]);

			if (!this._pendingMentionNotifications.has(docName)) {
				this._pendingMentionNotifications.set(docName, new Map());
			}
			const pendingForDoc = this._pendingMentionNotifications.get(docName);

			for (const ref of newUserRefs) {
				// Don't overwrite a pending entry — the first actor attribution wins.
				if (pendingForDoc.has(ref.nodeId)) continue;
				pendingForDoc.set(ref.nodeId, { ref, actorId, hasAccess: hasAccessSet.has(ref.targetId) });
			}
		} catch (err) {
			console.warn(`[references] _syncEntityReferences failed for ${docName}:`, err.message);
		}
	}

	/**
	 * Runs when the last WS client disconnects from a note room. Fires all
	 * deferred mention/assignment activities and creates implicit share
	 * invitations for users who don't already have access.
	 *
	 * @param {string} docName
	 * @param {import('yjs').Doc} yDoc
	 */
	async _flushPendingMentionNotifications(docName, yDoc) {
		const pendingForDoc = this._pendingMentionNotifications.get(docName);
		if (!pendingForDoc || pendingForDoc.size === 0) {
			this._pendingMentionNotifications.delete(docName);
			return;
		}
		this._pendingMentionNotifications.delete(docName);

		const workspaceId = this._docWorkspaceId.get(docName);
		if (!workspaceId) return;

		const colonIdx = docName.indexOf(':');
		const noteId = colonIdx >= 0 ? docName.slice(colonIdx + 1) : docName;
		const noteTitle = yDoc.getText('title').toString().trim() || null;

		for (const [, { ref, actorId, hasAccess }] of pendingForDoc) {
			const isAssignment = ref.listContext === 'taskItem' || ref.listContext === 'listItem';
			let invitationId = null;

			if (!hasAccess) {
				try {
					const existingPending = await this._prisma.noteShareInvitation.findFirst({
						where: {
							docId: docName,
							inviteeUserId: ref.targetId,
							source: 'mention',
							status: 'PENDING',
						},
						select: { id: true },
					});

					if (!existingPending) {
						if (actorId) {
							const invitee = await this._prisma.user.findUnique({
								where: { id: ref.targetId },
								select: { email: true, name: true },
							});
							if (invitee) {
								const invitation = await this._prisma.noteShareInvitation.create({
									data: {
										docId: docName,
										sourceWorkspaceId: workspaceId,
										sourceNoteId: noteId,
										inviterUserId: actorId,
										inviteeUserId: ref.targetId,
										inviteeEmail: invitee.email,
										inviteeName: invitee.name,
										role: ref.editRole === 'VIEWER' ? 'VIEWER' : 'EDITOR',
										source: 'mention',
										mentionExcerpt: ref.excerpt,
										status: 'PENDING',
									},
								});
								invitationId = invitation.id;

								this._onMentionInvitationCreated?.({
									targetUserId: ref.targetId,
									actorId,
									docId: docName,
									noteTitle,
									mentionExcerpt: ref.excerpt,
									editRole: ref.editRole || 'EDITOR',
								}).catch((err) => {
									console.warn(`[references] mention push failed for ${docName}:`, err?.message);
								});
							}
						}
					} else {
						invitationId = existingPending.id;
					}
				} catch (err) {
					console.warn(`[references] mention invitation create failed for ${docName}:`, err.message);
				}
			}

			await emitActivity(this._prisma, {
				kind: isAssignment ? 'assignment_created' : 'mention',
				actorId,
				sourceDocId: docName,
				sourceWorkspaceId: workspaceId,
				sourceNoteId: noteId,
				subjectType: isAssignment ? 'checklist_item' : 'note',
				subjectId: noteId,
				deepLink: { kind: 'prosemirror_node', nodeId: ref.nodeId },
				snapshot: {
					noteTitle,
					mentionExcerpt: ref.excerpt,
					assigneeLabel: ref.label,
					invitationId,
				},
				targetUserIds: [ref.targetId],
			}).then(() => {
				this._onActivityEmitted?.({ targetUserIds: [ref.targetId] });
				if (actorId) {
					this._onMentionNotification?.({
						targetUserId: ref.targetId,
						actorId,
						docId: docName,
						noteTitle,
						mentionExcerpt: ref.excerpt,
						editRole: ref.editRole || 'EDITOR',
					}).catch((err) => {
						console.warn(`[references] mention push failed for ${docName}:`, err?.message);
					});
				}
			}).catch((err) => {
				console.warn(`[references] activity emit failed for ${docName}:`, err.message);
			});
		}
	}

	/**
	 * Called from the REST endpoint when the client closes a note editor.
	 * Ensures any recent mention edits are synced and all pending notifications
	 * for that room are fired immediately, without waiting for WS disconnect.
	 *
	 * @param {string} noteId — Just the noteId portion (no workspace prefix).
	 */
	async flushMentionsForNote(noteId) {
		// Find the active room for this noteId. Room names are workspaceId:noteId.
		for (const [docName, yDoc] of this._activeDocs) {
			const colonIdx = docName.indexOf(':');
			if (colonIdx < 0 || docName.slice(colonIdx + 1) !== noteId) continue;

			const workspaceId = this._docWorkspaceId.get(docName);
			if (!workspaceId) break;

			// Ensure refs from any recent edits are in the pending map before flush.
			await this._syncEntityReferences(docName, yDoc, workspaceId).catch((err) => {
				console.warn('[refs] flush-on-close sync failed:', err.message);
			});
			await this._flushPendingMentionNotifications(docName, yDoc).catch((err) => {
				console.warn('[refs] flush-on-close notifications failed:', err.message);
			});
			break;
		}
	}

	// ─── Debounced auto-save ──────────────────────────────────────────────────

	/**
	 * Schedules (or resets) a debounced persistence write for the given room.
	 * Called from the Y.Doc 'update' listener registered in bindState.
	 *
	 * @param {string} docName — Yjs room name.
	 */
	_scheduleDebouncedWrite(docName) {
		// Clear any existing timer for this room.
		this._clearDebounce(docName);

		const timer = setTimeout(async () => {
			this._debounceTimers.delete(docName);
			const yDoc = this._activeDocs.get(docName);
			if (!yDoc) return; // Doc was already written and removed (race condition guard).
			try {
				await this._persistDoc(docName, yDoc);
			} catch (err) {
				console.error(`[persist] debounced write failed for room=${docName}:`, err.message);
			}
		}, this._debounceMs);

		this._debounceTimers.set(docName, timer);
	}

	/**
	 * Apply a Yjs binary update to the in-memory doc for docName, if it is
	 * currently active (i.e. has at least one connected WebSocket client).
	 *
	 * Used by the import router to push imported notes into the live Yjs room so
	 * connected clients see the new content immediately without reconnecting.
	 * The existing 'update' listener fires, scheduling the normal debounced DB
	 * write that will persist the change.
	 *
	 * @param {string} docName — Yjs room name (e.g. "workspaceId:__notes_registry__").
	 * @param {Uint8Array} updateBytes — Yjs binary update (delta, not full state).
	 * @returns {boolean} true if the update was applied to an active in-memory doc.
	 */
	applyExternalUpdate(docName, updateBytes) {
		const doc = this._activeDocs.get(docName);
		if (!doc) return false;
		try {
			Y.applyUpdate(doc, updateBytes, 'import');
		} catch (err) {
			console.warn(`[persist] applyExternalUpdate failed for ${docName}:`, err?.message);
			return false;
		}
		return true;
	}

	/**
	 * Write a doc state blob directly to the Redis cache for a given room.
	 * Used by the import router to keep the cache consistent after writing
	 * directly to PostgreSQL, so the next WS bindState serves fresh data
	 * instead of a stale entry.
	 *
	 * No-op when Redis is not configured.
	 *
	 * @param {string} docName — Yjs room name.
	 * @param {string} workspaceId — Workspace that owns this room.
	 * @param {Buffer | Uint8Array} state — Full Yjs state blob (encodeStateAsUpdate).
	 * @returns {Promise<void>}
	 */
	async writeDocToCache(docName, workspaceId, state) {
		if (!this._redis) return;
		await this._cacheToRedis(docName, workspaceId, state);
	}

	/**
	 * Cancels a pending debounce timer for the given room, if any.
	 *
	 * @param {string} docName — Yjs room name.
	 */
	_clearDebounce(docName) {
		const existing = this._debounceTimers.get(docName);
		if (existing) {
			clearTimeout(existing);
			this._debounceTimers.delete(docName);
		}
	}

	// ─── Cleanup ──────────────────────────────────────────────────────────────

	/**
	 * Flushes all active docs to PostgreSQL immmediately and tears down
	 * all debounce timers. Call this on graceful server shutdown.
	 *
	 * @returns {Promise<void>}
	 */
	async flushAll() {
		// Cancel all pending debounce timers.
		for (const [docName, timer] of this._debounceTimers) {
			clearTimeout(timer);
			this._debounceTimers.delete(docName);
		}

		// Flush each active doc to durable storage.
		const entries = Array.from(this._activeDocs.entries());
		const results = await Promise.allSettled(
			entries.map(([docName, yDoc]) => this._persistDoc(docName, yDoc))
		);

		// Log any failures.
		results.forEach((result, i) => {
			if (result.status === 'rejected') {
				console.error(`[persist] flushAll failed for room=${entries[i][0]}:`, result.reason);
			}
		});

		console.info(`[persist] flushAll complete: ${entries.length} docs processed`);
	}

	/**
	 * Full teardown: flush all docs, disconnect Redis if connected.
	 * Call this when the server is shutting down.
	 *
	 * @returns {Promise<void>}
	 */
	async destroy() {
		await this.flushAll();
		if (this._redis) {
			try {
				this._redis.disconnect();
			} catch {
				// ignore
			}
		}
	}
}

module.exports = { YjsPersistenceAdapter };
