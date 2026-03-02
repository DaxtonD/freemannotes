'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// trashCleanup.js – Server-side automatic cleanup of expired trashed notes.
//
// Periodically scans all persisted Yjs documents for notes whose metadata
// contains `trashed === true` with a `trashedAt` timestamp older than the
// user's configured `deleteAfterDays` preference. Matching notes are
// permanently deleted from both PostgreSQL and Redis.
//
// The cleanup runs on a configurable interval (default: every 60 minutes)
// and also performs an initial scan shortly after server boot (30-second
// delay to allow workspace initialization to complete).
//
// Architecture:
//   - Decodes each persisted Yjs doc's binary state to read the metadata map.
//   - Compares `trashedAt + deleteAfterDays` against the current time.
//   - Deletes the Yjs document row from PostgreSQL and invalidates Redis cache.
//   - Also removes the note from the notes registry Yjs doc (if still present)
//     so cross-tab CRDT sync picks up the removal.
//   - Logs a summary each cycle with the number of expired notes cleaned up.
//
// Design:
//   - The cleanup is purely server-side — no client involvement required.
//   - It operates on persisted state only (PostgreSQL rows), not in-memory docs.
//   - Safe to run while clients are connected: Yjs handles the conflict
//     resolution when the registry update propagates.
//
// Dependencies:
//   - @prisma/client (PostgreSQL ORM)
//   - yjs (for decoding binary doc state to read metadata)
//   - ioredis (optional — used to invalidate Redis cache entries)
// ─────────────────────────────────────────────────────────────────────────────

const Y = require('yjs');

// ── Configuration constants ─────────────────────────────────────────────────

/** Default cleanup interval in milliseconds (60 minutes). */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before first cleanup run after server boot (30 seconds). */
const INITIAL_DELAY_MS = 30 * 1000;

/** The notes registry room name (must match DocumentManager). */
const NOTES_REGISTRY_ID = '__notes_registry__';

/** Default retention period if no user preference exists (30 days). */
const DEFAULT_DELETE_AFTER_DAYS = 30;

/** Maximum time (ms) to wait for a Redis operation before giving up. */
const REDIS_TIMEOUT_MS = 3000;

/**
 * Wraps a promise with a timeout so Redis calls don't hang indefinitely.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error('Redis operation timed out')), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates and starts the trash cleanup scheduler.
 *
 * @param {object} deps — Injected dependencies.
 * @param {import('@prisma/client').PrismaClient} deps.prisma — Prisma client.
 * @param {import('./YjsPersistenceAdapter').YjsPersistenceAdapter} deps.adapter — Persistence adapter (for workspace ID + Redis access).
 * @param {import('ioredis').Redis | null} [deps.redis] — Optional Redis client for cache invalidation.
 * @param {number} [deps.intervalMs] — Cleanup interval in ms (default: 60 min).
 * @returns {{ stop: () => void, runNow: () => Promise<number> }}
 *   - `stop()` — Cancels the periodic cleanup timer.
 *   - `runNow()` — Triggers an immediate cleanup cycle; returns the number of notes deleted.
 */
function createTrashCleanup({ prisma, adapter, redis = null, intervalMs = DEFAULT_CLEANUP_INTERVAL_MS }) {
	/** @type {ReturnType<typeof setInterval> | null} */
	let intervalTimer = null;

	/** @type {ReturnType<typeof setTimeout> | null} */
	let initialTimer = null;

	/**
	 * Runs a single cleanup cycle.
	 *
	 * 1. Reads the user's deleteAfterDays preference.
	 * 2. Fetches all Yjs doc rows from PostgreSQL for the active workspace.
	 * 3. Decodes each doc's binary state and checks metadata for trash expiry.
	 * 4. Permanently deletes expired docs from PostgreSQL and Redis.
	 * 5. Removes expired note IDs from the notes registry (CRDT sync).
	 *
	 * @returns {Promise<number>} Number of notes permanently deleted.
	 */
	async function runCleanupCycle() {
		const workspaceId = adapter.getWorkspaceId();
		if (!workspaceId) {
			console.warn('[trash-cleanup] Skipping cycle — workspace not initialized yet');
			return 0;
		}

		const cycleStart = Date.now();

		// ── Step 1: Read the user's deleteAfterDays preference ──────────
		let deleteAfterDays = DEFAULT_DELETE_AFTER_DAYS;
		try {
			const pref = await prisma.userPreference.findUnique({
				where: { userId: 'default' },
				select: { deleteAfterDays: true },
			});
			if (pref && typeof pref.deleteAfterDays === 'number' && pref.deleteAfterDays > 0) {
				deleteAfterDays = pref.deleteAfterDays;
			}
		} catch (err) {
			console.warn('[trash-cleanup] Could not read user preferences, using default:', err.message);
		}

		const retentionMs = deleteAfterDays * 24 * 60 * 60 * 1000;
		const cutoffTimestamp = cycleStart - retentionMs;

		// ── Step 2: Fetch all persisted docs for the workspace ──────────
		let allDocs;
		try {
			allDocs = await prisma.yjsDocument.findMany({
				where: { workspaceId },
				select: { id: true, docId: true, state: true },
			});
		} catch (err) {
			console.error('[trash-cleanup] Failed to fetch docs from PostgreSQL:', err.message);
			return 0;
		}

		// ── Step 3: Identify expired trashed notes ──────────────────────
		const expiredDocIds = [];
		const expiredNoteIds = [];

		for (const row of allDocs) {
			// Skip the notes registry doc itself — it's not a note.
			if (row.docId === NOTES_REGISTRY_ID) continue;
			if (!row.state || row.state.length === 0) continue;

			try {
				// Decode the binary Yjs state into a temporary Y.Doc to read metadata.
				const tempDoc = new Y.Doc();
				Y.applyUpdate(tempDoc, new Uint8Array(row.state));
				const metadata = tempDoc.getMap('metadata');

				const trashed = Boolean(metadata.get('trashed'));
				const trashedAt = metadata.get('trashedAt');

				tempDoc.destroy();

				// Only delete if: note is trashed AND trashedAt is older than the cutoff.
				// trashedAt is stored as an ISO-8601 string (e.g. "2026-03-01T12:00:00.000Z").
				// Parse it to epoch-ms for numeric comparison against the cutoff.
				if (trashed && typeof trashedAt === 'string') {
					const trashedAtMs = new Date(trashedAt).getTime();
					if (Number.isFinite(trashedAtMs) && trashedAtMs <= cutoffTimestamp) {
						expiredDocIds.push(row.id);
						expiredNoteIds.push(row.docId);
					}
				}
			} catch (err) {
				// Corrupted doc state — log but continue scanning others.
				console.warn(`[trash-cleanup] Failed to decode doc ${row.docId}:`, err.message);
			}
		}

		if (expiredNoteIds.length === 0) {
			console.info(
				`[trash-cleanup] Cycle complete in ${Date.now() - cycleStart}ms — ` +
				`0 expired notes (scanned ${allDocs.length} docs, retention=${deleteAfterDays}d)`
			);
			return 0;
		}

		// ── Step 4: Permanently delete expired docs from PostgreSQL ─────
		let deletedCount = 0;
		try {
			const result = await prisma.yjsDocument.deleteMany({
				where: { id: { in: expiredDocIds } },
			});
			deletedCount = result.count;
		} catch (err) {
			console.error('[trash-cleanup] Failed to delete expired docs from PostgreSQL:', err.message);
			return 0;
		}

		// ── Step 5: Invalidate Redis cache for deleted docs ─────────────
		if (redis) {
			for (const noteId of expiredNoteIds) {
				try {
					const key = `fn:yjs:${adapter._workspaceName || 'default'}:${noteId}`;
					await withTimeout(redis.del(key), REDIS_TIMEOUT_MS);
				} catch (err) {
					console.warn(`[trash-cleanup] Failed to invalidate Redis cache for ${noteId}:`, err.message);
				}
			}
		}

		// ── Step 6: Remove from notes registry (CRDT propagation) ───────
		// Load the persisted registry doc, remove references to the deleted
		// notes, and write the updated state back to PostgreSQL. This ensures
		// that when clients next sync, they receive the removal.
		try {
			const registryRow = await prisma.yjsDocument.findUnique({
				where: {
					workspaceId_docId: { workspaceId, docId: NOTES_REGISTRY_ID },
				},
				select: { state: true },
			});

			if (registryRow && registryRow.state && registryRow.state.length > 0) {
				const registryDoc = new Y.Doc();
				Y.applyUpdate(registryDoc, new Uint8Array(registryRow.state));

				const expiredSet = new Set(expiredNoteIds);
				let registryModified = false;

				// Remove from notesList (Y.Array<Y.Map>).
				const notesList = registryDoc.getArray('notesList');
				const notesArr = notesList.toArray();
				// Walk backwards to avoid index-shifting on delete.
				for (let i = notesArr.length - 1; i >= 0; i--) {
					const item = notesArr[i];
					const id = typeof item.get === 'function'
						? String(item.get('id') ?? '').trim()
						: String(item ?? '').trim();
					if (expiredSet.has(id)) {
						registryDoc.transact(() => { notesList.delete(i, 1); });
						registryModified = true;
					}
				}

				// Remove from noteOrder (Y.Array<string>).
				const noteOrder = registryDoc.getArray('noteOrder');
				const orderArr = noteOrder.toArray();
				for (let i = orderArr.length - 1; i >= 0; i--) {
					if (expiredSet.has(String(orderArr[i]).trim())) {
						registryDoc.transact(() => { noteOrder.delete(i, 1); });
						registryModified = true;
					}
				}

				// Write modified registry back to PostgreSQL.
				if (registryModified) {
					const updatedState = Buffer.from(Y.encodeStateAsUpdate(registryDoc));
					const updatedVector = Buffer.from(Y.encodeStateVector(registryDoc));
					await prisma.yjsDocument.update({
						where: {
							workspaceId_docId: { workspaceId, docId: NOTES_REGISTRY_ID },
						},
						data: {
							state: updatedState,
							stateVector: updatedVector,
						},
					});

					// Also refresh the Redis cache for the registry.
					if (redis) {
						try {
							const key = `fn:yjs:${adapter._workspaceName || 'default'}:${NOTES_REGISTRY_ID}`;
							await withTimeout(redis.set(key, updatedState, 'EX', 86400), REDIS_TIMEOUT_MS);
						} catch (err) {
							console.warn('[trash-cleanup] Failed to update Redis cache for registry:', err.message);
						}
					}
				}

				registryDoc.destroy();
			}
		} catch (err) {
			// Non-fatal: the rows are already deleted from the yjs_document table.
			// The registry will be cleaned up on the next cycle or when clients
			// interact with the stale entries.
			console.warn('[trash-cleanup] Failed to update notes registry:', err.message);
		}

		// ── Step 7: Log summary ─────────────────────────────────────────
		const elapsed = Date.now() - cycleStart;
		console.info(
			`[trash-cleanup] Cycle complete in ${elapsed}ms — ` +
			`${deletedCount} notes permanently deleted ` +
			`(scanned ${allDocs.length} docs, retention=${deleteAfterDays}d)`
		);

		// Dev-mode warning: if any of the deleted notes might still be open
		// in a connected client. This is best-effort — the server doesn't
		// track individual WebSocket rooms directly, but the log helps
		// during development.
		if (process.env.NODE_ENV !== 'production') {
			for (const noteId of expiredNoteIds) {
				console.warn(
					`[trash-cleanup] [DEV] Permanently deleted note "${noteId}" — ` +
					`if this note was open in another tab, the client will receive ` +
					`a registry removal via CRDT sync.`
				);
			}
		}

		return deletedCount;
	}

	// ── Schedule periodic cleanup ───────────────────────────────────────────

	// Delay the first run to allow the server to finish booting and
	// the workspace to be fully initialized.
	initialTimer = setTimeout(() => {
		initialTimer = null;
		runCleanupCycle().catch((err) => {
			console.error('[trash-cleanup] Initial cycle failed:', err.message);
		});

		// Schedule subsequent runs at the configured interval.
		intervalTimer = setInterval(() => {
			runCleanupCycle().catch((err) => {
				console.error('[trash-cleanup] Periodic cycle failed:', err.message);
			});
		}, intervalMs);
	}, INITIAL_DELAY_MS);

	console.info(
		`[trash-cleanup] Scheduler started — ` +
		`initial run in ${INITIAL_DELAY_MS / 1000}s, then every ${intervalMs / 60000} min`
	);

	return {
		/**
		 * Stops the cleanup scheduler. Call this on graceful shutdown.
		 */
		stop() {
			if (initialTimer) {
				clearTimeout(initialTimer);
				initialTimer = null;
			}
			if (intervalTimer) {
				clearInterval(intervalTimer);
				intervalTimer = null;
			}
			console.info('[trash-cleanup] Scheduler stopped');
		},

		/**
		 * Triggers an immediate cleanup cycle (useful for testing or manual invocation).
		 * @returns {Promise<number>} Number of notes permanently deleted.
		 */
		runNow: runCleanupCycle,
	};
}

module.exports = { createTrashCleanup };
