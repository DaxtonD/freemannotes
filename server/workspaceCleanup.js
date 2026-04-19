'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// workspaceCleanup.js — Server-side cleanup of soft-deleted workspaces.
//
// Periodically scans for workspace rows with `deletedAt` older than a configured
// grace period and permanently deletes them. The database schema cascades the
// delete to workspace-scoped child rows, so the cleanup can remove the root
// workspace row without bespoke table-by-table cleanup logic.
//
// Why this exists instead of immediate hard-delete:
//   - Keeps the request-time delete path low risk.
//   - Gives active websocket/Yjs sessions time to tear down naturally.
//   - Matches the existing trash cleanup pattern already used in the server.
// ─────────────────────────────────────────────────────────────────────────────

/** Default cleanup interval in milliseconds (60 minutes). */
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before first cleanup run after server boot (30 seconds). */
const INITIAL_DELAY_MS = 30 * 1000;

/** Default grace period before soft-deleted workspaces are hard-deleted (24h). */
const DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Creates and starts the workspace cleanup scheduler.
 *
 * @param {object} deps
 * @param {import('@prisma/client').PrismaClient} deps.prisma
 * @param {number} [deps.intervalMs]
 * @param {number} [deps.gracePeriodMs]
 * @returns {{ stop: () => void, runNow: () => Promise<number> }}
 */
function createWorkspaceCleanup({
	prisma,
	intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
	gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
}) {
	/** @type {ReturnType<typeof setInterval> | null} */
	let intervalTimer = null;

	/** @type {ReturnType<typeof setTimeout> | null} */
	let initialTimer = null;

	async function runCleanupCycle() {
		const cycleStart = Date.now();
		const effectiveGraceMs = Math.max(0, Number(gracePeriodMs) || 0);
		const cutoff = new Date(cycleStart - effectiveGraceMs);

		let expiredWorkspaces = [];
		try {
			expiredWorkspaces = await prisma.workspace.findMany({
				where: {
					deletedAt: { not: null, lte: cutoff },
				},
				select: { id: true },
			});
		} catch (err) {
			console.error('[workspace-cleanup] Failed to fetch expired workspaces:', err.message);
			return 0;
		}

		if (expiredWorkspaces.length === 0) {
			console.info(
				`[workspace-cleanup] Cycle complete in ${Date.now() - cycleStart}ms — ` +
				`0 expired workspaces (grace=${effectiveGraceMs}ms)`
			);
			return 0;
		}

		const workspaceIds = expiredWorkspaces
			.map((row) => String(row.id || '').trim())
			.filter(Boolean);

		if (workspaceIds.length === 0) {
			return 0;
		}

		let deletedCount = 0;
		try {
			const result = await prisma.workspace.deleteMany({
				where: { id: { in: workspaceIds } },
			});
			deletedCount = Number(result?.count || 0);
		} catch (err) {
			console.error('[workspace-cleanup] Failed to hard-delete expired workspaces:', err.message);
			return 0;
		}

		console.info(
			`[workspace-cleanup] Cycle complete in ${Date.now() - cycleStart}ms — ` +
			`${deletedCount} expired workspaces hard-deleted (grace=${effectiveGraceMs}ms)`
		);
		return deletedCount;
	}

	initialTimer = setTimeout(() => {
		runCleanupCycle().catch((err) => {
			console.error('[workspace-cleanup] Initial cleanup cycle failed:', err.message);
		});
	}, INITIAL_DELAY_MS);
	if (typeof initialTimer.unref === 'function') {
		initialTimer.unref();
	}

	intervalTimer = setInterval(() => {
		runCleanupCycle().catch((err) => {
			console.error('[workspace-cleanup] Periodic cleanup cycle failed:', err.message);
		});
	}, Math.max(1000, Number(intervalMs) || DEFAULT_CLEANUP_INTERVAL_MS));
	if (typeof intervalTimer.unref === 'function') {
		intervalTimer.unref();
	}

	return {
		stop() {
			if (initialTimer) {
				clearTimeout(initialTimer);
				initialTimer = null;
			}
			if (intervalTimer) {
				clearInterval(intervalTimer);
				intervalTimer = null;
			}
		},
		runNow() {
			return runCleanupCycle();
		},
	};
}

module.exports = {
	createWorkspaceCleanup,
};