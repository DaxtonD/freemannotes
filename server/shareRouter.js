'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// shareRouter.js — Share links for read-only document snapshots.
//
// Endpoints:
//   - POST /api/docs/:docId/share
//       Requires auth + workspace membership. Creates a share token for the
//       requested doc and returns a public URL.
//   - GET /api/share/:token
//       Public endpoint that returns a *snapshot* of the document contents.
//       This does not grant Yjs sync access; it only reads persisted state.
//
// Notes on IDs:
//   - Documents may be stored as "namespaced" ids of the form
//     `${workspaceId}:${docId}`. The share creator accepts either.
//
// Security model:
//   - Creating a share token is protected by cookie auth + same-origin checks.
//   - Reading a share token is public, but tokens are unguessable and expire.
//   - Returned content is derived from persisted Yjs state.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const Y = require('yjs');
const { createTimestampFormatter } = require('./timezone');
const { enforceSameOrigin } = require('./auth');
const { findLiveWorkspaceMembership } = require('./workspaceAccess');

function jsonResponse(res, status, body) {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(json);
}

function appBaseUrlFromRequest(req) {
	const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
	const proto = forwardedProto || 'http';
	const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
	const host = forwardedHost || String(req.headers.host || 'localhost');
	return `${proto}://${host}`;
}

function createShareRouter({ prisma, timezone = null }) {
	const fmt = createTimestampFormatter(timezone);

	function requireAuthWorkspace(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		if (!req.auth.workspaceId) {
			jsonResponse(res, 400, { error: 'No active workspace' });
			return null;
		}
		return { userId: req.auth.userId, workspaceId: req.auth.workspaceId };
	}

	function namespacedDocId(workspaceId, rawDocId) {
		return `${workspaceId}:${rawDocId}`;
	}

	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		// CSRF mitigation for cookie-authenticated endpoints.
		if (!enforceSameOrigin(req, res)) return true;

		// POST /api/docs/:docId/share
		const createMatch = pathname.match(/^\/api\/docs\/([^/]+)\/share$/);
		if (createMatch && method === 'POST') {
			const rawDocId = decodeURIComponent(createMatch[1]);
			(async () => {
				try {
					const session = requireAuthWorkspace(req, res);
					if (!session) return;

					const membership = await findLiveWorkspaceMembership(prisma, session.userId, session.workspaceId, { workspaceId: true });
					if (!membership) {
						jsonResponse(res, 403, { error: 'Forbidden' });
						return;
					}

					const stored = namespacedDocId(session.workspaceId, rawDocId);
					let doc = await prisma.document.findFirst({
						where: { docId: stored, workspaceId: session.workspaceId },
						select: { docId: true },
					});
					if (!doc) {
						doc = await prisma.document.findFirst({
							where: { docId: rawDocId, workspaceId: session.workspaceId },
							select: { docId: true },
						});
					}
					// Backward-compat: earlier builds accidentally double-namespaced room IDs
					// ("<ws>:<ws>:<docId>"). Try to find and migrate to the canonical
					// single-namespaced form ("<ws>:<docId>") so shares work immediately.
					if (!doc) {
						const doubleStored = namespacedDocId(session.workspaceId, stored);
						const legacy = await prisma.document.findFirst({
							where: { docId: doubleStored, workspaceId: session.workspaceId },
							select: { id: true, docId: true },
						});
						if (legacy) {
							try {
								await prisma.document.update({
									where: { id: legacy.id },
									data: { docId: stored },
								});
								doc = { docId: stored };
								console.info(`[share] migrated double docId: ${doubleStored} -> ${stored}`);
							} catch {
								// If a canonical row already exists, keep using the legacy ID.
								doc = { docId: legacy.docId };
							}
						}
					}
					if (!doc) {
						jsonResponse(res, 404, { error: 'Document not found' });
						return;
					}

					const token = crypto.randomBytes(24).toString('hex');
					const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

					await prisma.shareToken.create({
						data: {
							docId: doc.docId,
							token,
							expiresAt,
							role: 'MEMBER',
						},
					});

					const base = String(process.env.APP_URL || '').trim() || appBaseUrlFromRequest(req);
					const shareUrl = `${base.replace(/\/$/, '')}/share/${token}`;

					jsonResponse(res, 201, { token, shareUrl, expiresAt: expiresAt.toISOString() });
				} catch (err) {
					console.error('[share] create error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// GET /api/share/:token (public read-only snapshot)
		const readMatch = pathname.match(/^\/api\/share\/([^/]+)$/);
		if (readMatch && method === 'GET') {
			const token = decodeURIComponent(readMatch[1]);
			(async () => {
				try {
					const share = await prisma.shareToken.findUnique({
						where: { token },
						select: { expiresAt: true, docId: true },
					});
					if (!share) {
						jsonResponse(res, 404, { error: 'Share not found' });
						return;
					}
					if (share.expiresAt.getTime() < Date.now()) {
						jsonResponse(res, 410, { error: 'Share expired' });
						return;
					}

					const row = await prisma.document.findUnique({
						where: { docId: share.docId },
						select: { state: true, updatedAt: true, createdAt: true },
					});
					if (!row || !row.state) {
						jsonResponse(res, 404, { error: 'Document not found' });
						return;
					}

					const tempDoc = new Y.Doc();
					Y.applyUpdate(tempDoc, new Uint8Array(row.state));
					const title = tempDoc.getText('title').toString();
					const content = tempDoc.getText('content').toString();
					const rawMetadata = tempDoc.getMap('metadata').toJSON();
					const checklist = tempDoc.getArray('checklist').toJSON();
					tempDoc.destroy();

					const metadata = { ...rawMetadata };
					if (typeof metadata.createdAt === 'number') metadata.createdAt = fmt(metadata.createdAt);
					if (typeof metadata.updatedAt === 'number') metadata.updatedAt = fmt(metadata.updatedAt);

					jsonResponse(res, 200, {
						expiresAt: share.expiresAt.toISOString(),
						snapshot: {
							title,
							content,
							metadata,
							checklist,
						},
						updatedAt: fmt(row.updatedAt),
						createdAt: fmt(row.createdAt),
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error('[share] read error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createShareRouter };
