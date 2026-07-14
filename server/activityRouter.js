'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// activityRouter – Inbox / activity stream REST endpoints.
//
//   GET  /api/inbox          paginated activity stream for the current user
//   GET  /api/inbox/count    unread count only (for badge polling)
//   POST /api/inbox/read     mark activities as read
//   POST /api/inbox/archive  soft-archive activities (hides from inbox,
//                            preserves rows for future Activity History view)
//   GET  /api/workspace/members   workspace member list (needed for @ search)
//
// All endpoints require authentication. Activities are scoped to the
// authenticated user via ActivityTarget; workspace membership is not
// required because shared-note activities span workspaces.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function jsonResponse(res, status, body) {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(json);
}

function readJsonBody(req) {
	return new Promise((resolve) => {
		const chunks = [];
		req.on('data', (chunk) => chunks.push(chunk));
		req.on('end', () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
			} catch {
				resolve(null);
			}
		});
		req.on('error', () => resolve(null));
	});
}

function normalizeId(value) {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeIds(value) {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map(normalizeId).filter(Boolean))];
}

function mapActivity(row, userId) {
	return {
		id: row.id,
		kind: row.kind,
		createdAt: row.createdAt.toISOString(),
		read: row.reads.some((r) => r.userId === userId && !r.archived),
		archived: row.reads.some((r) => r.userId === userId && r.archived),
		actor: row.actor
			? { id: row.actor.id, name: row.actor.name, avatarUrl: row.actor.profileImage || null }
			: null,
		subject: {
			noteId: row.sourceNoteId,
			workspaceId: row.sourceWorkspaceId,
			subjectType: row.subjectType,
			subjectId: row.subjectId,
		},
		deepLink: row.deepLink,
		snapshot: row.snapshot || null,
	};
}

/**
 * @param {{ prisma: import('@prisma/client').PrismaClient, onWorkspaceMetadataChanged?: Function | null }} deps
 */
function createActivityRouter({ prisma, onWorkspaceMetadataChanged = null }) {
	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		function requireAuth() {
			if (!req.auth || !req.auth.userId) {
				jsonResponse(res, 401, { error: 'Not authenticated' });
				return null;
			}
			return String(req.auth.userId);
		}

		// ── GET /api/inbox ────────────────────────────────────────────────────
		// Returns paginated activity stream for the current user.
		// Query params: cursor (ISO timestamp), limit (default 50, max 100)
		// Only returns non-archived activities. Cursor is exclusive (items
		// strictly before the cursor timestamp are returned).
		if (pathname === '/api/inbox' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
					const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_PAGE_SIZE : rawLimit, MAX_PAGE_SIZE);
					const cursorParam = url.searchParams.get('cursor');
					const cursor = cursorParam ? new Date(cursorParam) : null;
					const kindParam = url.searchParams.get('kind') || null;

					const activities = await prisma.activity.findMany({
						where: {
							targets: { some: { userId } },
							reads: { none: { userId, archived: true } },
							...(cursor ? { createdAt: { lt: cursor } } : {}),
							...(kindParam ? { kind: kindParam } : {}),
						},
						orderBy: { createdAt: 'desc' },
						// fetch extra so we can filter out revoked-mention activities
						take: (limit + 1) * 2,
						include: {
							actor: { select: { id: true, name: true, profileImage: true } },
							reads: { where: { userId } },
						},
					});

					// Batch-lookup invitation statuses for mention activities
					const invitationIds = activities
						.map((a) => a.snapshot?.invitationId)
						.filter(Boolean);
					const invitationStatusMap = new Map();
					if (invitationIds.length > 0) {
						const invitations = await prisma.noteShareInvitation.findMany({
							where: { id: { in: invitationIds } },
							select: { id: true, status: true },
						});
						for (const inv of invitations) {
							invitationStatusMap.set(inv.id, inv.status);
						}
					}

					// Filter out mention activities whose invitation has been revoked
					const filtered = activities.filter((a) => {
						const invId = a.snapshot?.invitationId;
						if (!invId) return true;
						const status = invitationStatusMap.get(invId);
						return status !== 'REVOKED' && status !== 'DECLINED';
					});

					const hasMore = filtered.length > limit;
					const items = hasMore ? filtered.slice(0, limit) : filtered;
					const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

					jsonResponse(res, 200, {
						items: items.map((a) => ({
							...mapActivity(a, userId),
							invitationStatus: a.snapshot?.invitationId
								? (invitationStatusMap.get(a.snapshot.invitationId) ?? null)
								: null,
						})),
						nextCursor,
					});
				} catch (err) {
					console.error('[activity] GET /api/inbox error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── GET /api/inbox/count ──────────────────────────────────────────────
		// Returns the unread activity count for the badge, plus nodeIds of unread
		// prosemirror_node activities so the client can clear matching optimistic
		// pending-self-mention entries without waiting for InboxView to open.
		if (pathname === '/api/inbox/count' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					const [unread, unreadTargets] = await Promise.all([
						prisma.activityTarget.count({
							where: { userId, activity: { reads: { none: { userId } } } },
						}),
						prisma.activityTarget.findMany({
							where: { userId, activity: { reads: { none: { userId } } } },
							select: { activity: { select: { deepLink: true } } },
							take: 200,
						}),
					]);

					const nodeIds = unreadTargets
						.map((t) => t.activity?.deepLink)
						.filter((dl) => dl && typeof dl === 'object' && dl.kind === 'prosemirror_node' && typeof dl.nodeId === 'string')
						.map((dl) => dl.nodeId);

					jsonResponse(res, 200, { unread, nodeIds });
				} catch (err) {
					console.error('[activity] GET /api/inbox/count error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/inbox/read ──────────────────────────────────────────────
		// Marks one or more activities as read for the current user.
		// Body: { activityIds: string[] }
		if (pathname === '/api/inbox/read' && method === 'POST') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					const body = await readJsonBody(req);
					const activityIds = normalizeIds(body?.activityIds);
					if (activityIds.length === 0) {
						jsonResponse(res, 400, { error: 'activityIds must be a non-empty array' });
						return;
					}

					// Verify the user is a target for all provided activity IDs.
					const targetCount = await prisma.activityTarget.count({
						where: { userId, activityId: { in: activityIds } },
					});
					if (targetCount !== activityIds.length) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					await prisma.$transaction(
						activityIds.map((activityId) =>
							prisma.activityRead.upsert({
								where: { userId_activityId: { userId, activityId } },
								update: {},
								create: { userId, activityId },
							})
						)
					);

					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[activity] POST /api/inbox/read error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/inbox/archive ───────────────────────────────────────────
		// Soft-archives one or more activities for the current user.
		// Archived activities are hidden from the inbox but preserved for
		// future Activity History / Audit views.
		// Body: { activityIds: string[] }
		if (pathname === '/api/inbox/archive' && method === 'POST') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					const body = await readJsonBody(req);
					const activityIds = normalizeIds(body?.activityIds);
					if (activityIds.length === 0) {
						jsonResponse(res, 400, { error: 'activityIds must be a non-empty array' });
						return;
					}

					const targetCount = await prisma.activityTarget.count({
						where: { userId, activityId: { in: activityIds } },
					});
					if (targetCount !== activityIds.length) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const now = new Date();
					await prisma.$transaction(
						activityIds.map((activityId) =>
							prisma.activityRead.upsert({
								where: { userId_activityId: { userId, activityId } },
								update: { archived: true, archivedAt: now },
								create: { userId, activityId, archived: true, archivedAt: now },
							})
						)
					);

					jsonResponse(res, 200, { ok: true });
				} catch (err) {
					console.error('[activity] POST /api/inbox/archive error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/inbox/archive-all ──────────────────────────────────────
		// Archives ALL non-archived activities for the current user, regardless
		// of filter tab or pagination. Used by the "Clear all" button so that
		// the badge and inbox both reach zero, not just the visible subset.
		if (pathname === '/api/inbox/archive-all' && method === 'POST') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					// Find all activity IDs targeting this user that aren't already archived.
					const targets = await prisma.activityTarget.findMany({
						where: {
							userId,
							activity: { reads: { none: { userId, archived: true } } },
						},
						select: { activityId: true },
					});
					const activityIds = targets.map((t) => t.activityId);
					if (activityIds.length > 0) {
						const now = new Date();
						await prisma.$transaction(
							activityIds.map((activityId) =>
								prisma.activityRead.upsert({
									where: { userId_activityId: { userId, activityId } },
									update: { archived: true, archivedAt: now },
									create: { userId, activityId, archived: true, archivedAt: now },
								})
							)
						);
					}

					jsonResponse(res, 200, { archived: activityIds.length });
				} catch (err) {
					console.error('[activity] POST /api/inbox/archive-all error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── GET /api/workspace/members ────────────────────────────────────────
		// Returns all active members of the current user's active workspace.
		// Used by the @ reference autocomplete to find people to mention.
		// Requires workspace membership.
		if (pathname === '/api/workspace/members' && method === 'GET') {
			(async () => {
				try {
					const userId = requireAuth();
					if (!userId) return;

					const workspaceId = req.auth?.workspaceId;
					if (!workspaceId) {
						jsonResponse(res, 400, { error: 'No active workspace' });
						return;
					}

					const membership = await prisma.workspaceMember.findUnique({
						where: { userId_workspaceId: { userId, workspaceId } },
						select: { role: true },
					});
					if (!membership) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const members = await prisma.workspaceMember.findMany({
						where: {
							workspaceId,
							workspace: { is: { deletedAt: null } },
							user: { disabled: false },
						},
						include: {
							user: { select: { id: true, name: true, email: true, profileImage: true, isSupporter: true } },
						},
						orderBy: { user: { name: 'asc' } },
					});

					jsonResponse(res, 200, {
						members: members.map((m) => ({
							id: m.user.id,
							name: m.user.name,
							email: m.user.email,
							avatarUrl: m.user.profileImage || null,
							role: m.role,
							isSupporter: m.user.isSupporter ?? false,
						})),
					});
				} catch (err) {
					console.error('[activity] GET /api/workspace/members error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createActivityRouter };
