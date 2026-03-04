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

// ─── Configuration constants ────────────────────────────────────────────────

/** How often (ms) to auto-persist dirty docs while clients are connected. */
const DEBOUNCE_MS = 2000;

/** Default workspace name created on first boot if none exists. */
const DEFAULT_WORKSPACE_NAME = 'default';

/**
 * Maximum time (ms) to wait for a Redis operation before giving up.
 * Since maxRetriesPerRequest is null (commands queue forever), we apply our
 * own timeout so persistence is never blocked by an unreachable Redis.
 */
const REDIS_TIMEOUT_MS = 3000;

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
					select: { id: true, state: true, docId: true },
				});

				// Backward-compat: legacy installs stored un-namespaced docIds.
				// If the current docName looks like "<workspaceId>:<rawDocId>" and no
				// row exists yet, attempt to load the rawDocId and migrate it in-place.
				if (!row) {
					const idx = docName.indexOf(':');
					if (idx > 0) {
						const legacyDocId = docName.slice(idx + 1);
						if (legacyDocId) {
							const legacy = await this._prisma.document.findFirst({
								where: { docId: legacyDocId, workspaceId },
								select: { id: true, state: true },
							});
							if (legacy && legacy.state && legacy.state.length > 0) {
								// Migrate by renaming docId to the namespaced value.
								await this._prisma.document.update({
									where: { id: legacy.id },
									data: { docId: docName },
								});
								row = { id: legacy.id, state: legacy.state, docId: docName };
								console.info(`[persist] migrated legacy docId: ${legacyDocId} -> ${docName}`);
							}
						}
					}
				}
				if (row && row.state && row.state.length > 0) {
					Y.applyUpdate(yDoc, new Uint8Array(row.state));
					loaded = true;
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
			console.info(`[persist] no stored state for room=${docName} — starting fresh`);
		}

		// ── Register debounced update listener ───────────────────────────────
		// Every time the doc is modified, reset the debounce timer. When it
		// fires, the current state is flushed to PostgreSQL + Redis.
		const onUpdate = (_update, _origin) => {
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

		// Remove from active tracking.
		this._activeDocs.delete(docName);
		this._docWorkspaceId.delete(docName);
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

		try {
			const existing = await this._prisma.document.findUnique({
				where: { docId: docName },
				select: { id: true, workspaceId: true },
			});

			if (existing && existing.workspaceId !== workspaceId) {
				console.error(
					`[persist] refused to write cross-workspace doc: room=${docName} expected=${workspaceId} actual=${existing.workspaceId}`
				);
				return;
			}

			if (existing) {
				await this._prisma.document.update({
					where: { id: existing.id },
					data: { state, stateVector },
				});
			} else {
				await this._prisma.document.create({
					data: { workspaceId, docId: docName, state, stateVector },
				});
			}
			console.info(`[persist] saved to PostgreSQL: room=${docName} bytes=${state.length}`);
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
