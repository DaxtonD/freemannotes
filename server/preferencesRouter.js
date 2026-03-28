'use strict';

// ─────────────────────────────────────────────────────────────────────────────

const { resolveLiveWorkspaceId } = require('./workspaceAccess');
// User Preferences REST API router for FreemanNotes.
//
// Provides endpoints for reading and updating per-user preference values.
// Phase 11: preferences are scoped to the authenticated user (UUID userId).
// Requests without a valid session return 401.
//
// Endpoints:
//   GET  /api/user/preferences  — Returns all preferences for the current user.
//   POST /api/user/preferences  — Updates one or more preference values.
//
// The router follows the same plain-function pattern as apiRouter.js:
// it takes (req, res) and returns true if handled, false to fall through.
//
// Dependencies:
//   - @prisma/client (Prisma ORM for PostgreSQL)
//   - server/timezone.js (for consistent timestamp formatting)
// ─────────────────────────────────────────────────────────────────────────────

const { createTimestampFormatter } = require('./timezone');

// ── Default values ──────────────────────────────────────────────────────────

/** Default number of days a trashed note is retained before permanent deletion. */
const DEFAULT_DELETE_AFTER_DAYS = 30;

/** Persisted sentinel for "never auto-delete trashed notes". */
const NEVER_DELETE_AFTER_DAYS = 0;

/** Retention values exposed in the preferences UI. */
const ALLOWED_DELETE_AFTER_DAYS = new Set([7, 14, 30]);

/** Per-device display-size lower bound (75%). */
const MIN_FONT_SCALE = 0.75;

/** Per-device display-size upper bound (150%). */
const MAX_FONT_SCALE = 1.5;

/** Per-device note card height lower bound in px. */
const MIN_NOTE_CARD_HEIGHT_PX = 320;

/** Per-device note card height upper bound in px. */
const MAX_NOTE_CARD_HEIGHT_PX = 1400;

function normalizeFontScale(raw) {
	const value = Number(raw);
	if (!Number.isFinite(value)) return 1;
	return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a preferences API router function.
 *
 * @param {object} deps — Injected dependencies.
 * @param {import('@prisma/client').PrismaClient} deps.prisma — Prisma client instance.
 * @param {string | null} [deps.timezone] — IANA timezone for formatting timestamps.
 * @returns {(req: import('http').IncomingMessage, res: import('http').ServerResponse) => boolean}
 */
function createPreferencesRouter({ prisma, timezone = null }) {
	const fmt = createTimestampFormatter(timezone);

	const LEGACY_DEVICE_ID = 'legacy';

	/**
	 * Sends a JSON response with the given status code and body.
	 *
	 * @param {import('http').ServerResponse} res
	 * @param {number} status — HTTP status code.
	 * @param {any} body — JSON-serializable response body.
	 */
	function jsonResponse(res, status, body) {
		const json = JSON.stringify(body);
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
		});
		res.end(json);
	}

	/**
	 * Reads the full request body as a UTF-8 string and parses it as JSON.
	 * Returns the parsed object, or null if parsing fails.
	 *
	 * @param {import('http').IncomingMessage} req
	 * @returns {Promise<any | null>}
	 */
	function readJsonBody(req) {
		return new Promise((resolve) => {
			const chunks = [];
			req.on('data', (chunk) => chunks.push(chunk));
			req.on('end', () => {
				try {
					const raw = Buffer.concat(chunks).toString('utf-8');
					resolve(JSON.parse(raw));
				} catch {
					resolve(null);
				}
			});
			req.on('error', () => resolve(null));
		});
	}

	/**
	 * Formats a UserPreference row into the API response shape.
	 * Normalizes field names and formats timestamps through the timezone formatter.
	 *
	 * @param {object} row — Prisma UserPreference row.
	 * @returns {object} Formatted preference object.
	 */
	function formatPreference(row) {
		return {
			userId: row.userId,
			theme: row.theme ?? null,
			language: row.language ?? null,
			deleteAfterDays: row.deleteAfterDays > 0 ? row.deleteAfterDays : null,
			createdAt: fmt(row.createdAt),
			updatedAt: fmt(row.updatedAt),
			timezone: timezone || 'UTC',
		};
	}

	function formatDeleteAfterDays(value) {
		const days = Number(value);
		if (!Number.isFinite(days) || days <= 0) return null;
		return days;
	}

	function parseDeleteAfterDays(raw) {
		if (raw == null || raw === '') return NEVER_DELETE_AFTER_DAYS;
		const days = Number(raw);
		if (!Number.isFinite(days) || !Number.isInteger(days)) return null;
		if (days === NEVER_DELETE_AFTER_DAYS) return NEVER_DELETE_AFTER_DAYS;
		if (!ALLOWED_DELETE_AFTER_DAYS.has(days)) return null;
		return days;
	}

	function normalizeDeviceId(raw) {
		if (typeof raw !== 'string') return LEGACY_DEVICE_ID;
		const id = raw.trim();
		if (!id) return LEGACY_DEVICE_ID;
		// Keep reasonably bounded so it can't be abused as an unbounded key.
		if (id.length > 120) return LEGACY_DEVICE_ID;
		return id;
	}

	function normalizeNoteId(raw) {
		if (typeof raw !== 'string') return '';
		const id = raw.trim();
		if (!id) return '';
		if (id.length > 120) return '';
		return id;
	}

	function normalizeActiveSharedFolder(raw) {
		if (raw == null || raw === '') return null;
		if (typeof raw !== 'string') return null;
		const folderName = raw.trim();
		if (!folderName) return null;
		return folderName;
	}

	/**
	 * Returns authenticated userId (UUID) or null.
	 * @param {import('http').IncomingMessage} req
	 */
	function getUserId(req) {
		return req.auth && typeof req.auth.userId === 'string' && req.auth.userId.length > 0
			? req.auth.userId
			: null;
	}

	/**
	 * The main router handler. Returns true if the request was handled.
	 *
	 * @param {import('http').IncomingMessage} req
	 * @param {import('http').ServerResponse} res
	 * @returns {boolean}
	 */
	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		// ── GET /api/user/preferences ────────────────────────────────────
		// Returns the current user's preferences. If no preference row exists
		// yet, one is created with default values (upsert pattern).
		if (pathname === '/api/user/preferences' && method === 'GET') {
			(async () => {
				try {
					const userId = getUserId(req);
					if (!userId) {
						jsonResponse(res, 401, { error: 'Not authenticated' });
						return;
					}

					const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));

					// Upsert the user-scoped preferences (deleteAfterDays).
					const userPref = await prisma.userPreference.upsert({
						where: { userId },
						update: {},
						create: {
							userId,
							deleteAfterDays: DEFAULT_DELETE_AFTER_DAYS,
						},
					});

					// Upsert the device-scoped preferences.
					let devicePref = await prisma.userDevicePreference.upsert({
						where: { userId_deviceId: { userId, deviceId } },
						update: {},
						create: {
							userId,
							deviceId,
							noteCardFontScale: 1,
							noteEditorFontScale: 1,
							checklistShowCompleted: false,
							quickDeleteChecklist: false,
							noteCardCompletedExpandedByNoteId: {},
						},
					});
					const normalizedActiveWorkspaceId = await resolveLiveWorkspaceId(
						prisma,
						userId,
						devicePref.activeWorkspaceId ? String(devicePref.activeWorkspaceId) : null,
					);
					if ((devicePref.activeWorkspaceId ?? null) !== normalizedActiveWorkspaceId) {
						devicePref = await prisma.userDevicePreference.update({
							where: { userId_deviceId: { userId, deviceId } },
							data: { activeWorkspaceId: normalizedActiveWorkspaceId },
						});
					}

					jsonResponse(res, 200, {
						userId: userPref.userId,
						deviceId: devicePref.deviceId,
						deleteAfterDays: formatDeleteAfterDays(userPref.deleteAfterDays),
						theme: devicePref.theme ?? null,
						language: devicePref.language ?? null,
						noteCardFontScale: normalizeFontScale(devicePref.noteCardFontScale),
						noteEditorFontScale: normalizeFontScale(devicePref.noteEditorFontScale),
						noteCardMaxHeightPx: Number.isFinite(Number(devicePref.noteCardMaxHeightPx))
							? Number(devicePref.noteCardMaxHeightPx)
							: null,
						activeWorkspaceId: normalizedActiveWorkspaceId,
						activeSharedFolder: normalizeActiveSharedFolder(devicePref.activeSharedFolder),
						checklistShowCompleted: Boolean(devicePref.checklistShowCompleted),
						quickDeleteChecklist: Boolean(devicePref.quickDeleteChecklist),
						noteCardCompletedExpandedByNoteId: devicePref.noteCardCompletedExpandedByNoteId || {},
						createdAt: fmt(devicePref.createdAt),
						updatedAt: fmt(devicePref.updatedAt),
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error('[api] GET /api/user/preferences error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── POST /api/user/preferences ───────────────────────────────────
		// Updates one or more preference fields for the current user.
		// Accepts a JSON body with optional fields:
		//   { deleteAfterDays?: number }
		// Returns the full updated preference object.
		if (pathname === '/api/user/preferences' && method === 'POST') {
			(async () => {
				try {
					const userId = getUserId(req);
					if (!userId) {
						jsonResponse(res, 401, { error: 'Not authenticated' });
						return;
					}

					const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
					const deviceId = normalizeDeviceId(url.searchParams.get('deviceId'));

					const body = await readJsonBody(req);
					if (!body || typeof body !== 'object') {
						jsonResponse(res, 400, { error: 'Request body must be a JSON object' });
						return;
					}

					// ── Validate deleteAfterDays (user-scoped) ─────────────────
					const userUpdateData = {};
					if ('deleteAfterDays' in body) {
						const days = parseDeleteAfterDays(body.deleteAfterDays);
						if (days == null) {
							jsonResponse(res, 400, {
								error: 'deleteAfterDays must be one of 7, 14, 30, or null for never',
							});
							return;
						}
						userUpdateData.deleteAfterDays = days;
					}

					// ── Device-scoped updates ─────────────────────────────────
					const deviceUpdateData = {};
					if ('theme' in body) {
						if (body.theme == null || body.theme === '') {
							deviceUpdateData.theme = null;
						} else if (typeof body.theme !== 'string' || body.theme.length > 80) {
							jsonResponse(res, 400, { error: 'theme must be a string up to 80 chars' });
							return;
						} else {
							deviceUpdateData.theme = body.theme;
						}
					}

					if ('language' in body) {
						if (body.language == null || body.language === '') {
							deviceUpdateData.language = null;
						} else if (typeof body.language !== 'string' || body.language.length > 20) {
							jsonResponse(res, 400, { error: 'language must be a string up to 20 chars' });
							return;
						} else {
							deviceUpdateData.language = body.language;
						}
					}

					if ('noteCardFontScale' in body) {
						const scale = Number(body.noteCardFontScale);
						if (!Number.isFinite(scale) || scale < MIN_FONT_SCALE || scale > MAX_FONT_SCALE) {
							jsonResponse(res, 400, {
								error: `noteCardFontScale must be a number between ${MIN_FONT_SCALE} and ${MAX_FONT_SCALE}`,
							});
							return;
						}
						deviceUpdateData.noteCardFontScale = scale;
					}

					if ('noteEditorFontScale' in body) {
						const scale = Number(body.noteEditorFontScale);
						if (!Number.isFinite(scale) || scale < MIN_FONT_SCALE || scale > MAX_FONT_SCALE) {
							jsonResponse(res, 400, {
								error: `noteEditorFontScale must be a number between ${MIN_FONT_SCALE} and ${MAX_FONT_SCALE}`,
							});
							return;
						}
						deviceUpdateData.noteEditorFontScale = scale;
					}

					if ('noteCardMaxHeightPx' in body) {
						if (body.noteCardMaxHeightPx == null || body.noteCardMaxHeightPx === '') {
							deviceUpdateData.noteCardMaxHeightPx = null;
						} else {
							const height = Number(body.noteCardMaxHeightPx);
							if (!Number.isFinite(height) || !Number.isInteger(height) || height < MIN_NOTE_CARD_HEIGHT_PX || height > MAX_NOTE_CARD_HEIGHT_PX) {
								jsonResponse(res, 400, {
									error: `noteCardMaxHeightPx must be an integer between ${MIN_NOTE_CARD_HEIGHT_PX} and ${MAX_NOTE_CARD_HEIGHT_PX}`,
								});
								return;
							}
							deviceUpdateData.noteCardMaxHeightPx = height;
						}
					}

					if ('activeSharedFolder' in body) {
						if (body.activeSharedFolder == null || body.activeSharedFolder === '') {
							deviceUpdateData.activeSharedFolder = null;
						} else if (typeof body.activeSharedFolder !== 'string' || body.activeSharedFolder.length > 200) {
							jsonResponse(res, 400, { error: 'activeSharedFolder must be a string up to 200 chars' });
							return;
						} else {
							deviceUpdateData.activeSharedFolder = normalizeActiveSharedFolder(body.activeSharedFolder);
						}
					}

					if ('checklistShowCompleted' in body) {
						deviceUpdateData.checklistShowCompleted = Boolean(body.checklistShowCompleted);
					}

					if ('quickDeleteChecklist' in body) {
						deviceUpdateData.quickDeleteChecklist = Boolean(body.quickDeleteChecklist);
					}

					if ('noteCardCompletedExpandedPatch' in body) {
						const patch = body.noteCardCompletedExpandedPatch;
						if (!patch || typeof patch !== 'object') {
							jsonResponse(res, 400, { error: 'noteCardCompletedExpandedPatch must be an object' });
							return;
						}
						const noteId = normalizeNoteId(patch.noteId);
						if (!noteId) {
							jsonResponse(res, 400, { error: 'noteCardCompletedExpandedPatch.noteId is required' });
							return;
						}
						const expanded = Boolean(patch.expanded);
						// We'll merge this patch after reading current state (below).
						deviceUpdateData.__noteCardPatch = { noteId, expanded };
					}

					const hasUserUpdates = Object.keys(userUpdateData).length > 0;
					const hasDeviceUpdates = Object.keys(deviceUpdateData).length > 0;
					if (!hasUserUpdates && !hasDeviceUpdates) {
						// Return current state.
						const userPref = await prisma.userPreference.upsert({
							where: { userId },
							update: {},
							create: {
								userId,
								deleteAfterDays: DEFAULT_DELETE_AFTER_DAYS,
							},
						});
						let devicePref = await prisma.userDevicePreference.upsert({
							where: { userId_deviceId: { userId, deviceId } },
							update: {},
							create: {
								userId,
								deviceId,
								noteCardFontScale: 1,
								noteEditorFontScale: 1,
								checklistShowCompleted: false,
								quickDeleteChecklist: false,
								noteCardCompletedExpandedByNoteId: {},
							},
						});
						const normalizedActiveWorkspaceId = await resolveLiveWorkspaceId(
							prisma,
							userId,
							devicePref.activeWorkspaceId ? String(devicePref.activeWorkspaceId) : null,
						);
						if ((devicePref.activeWorkspaceId ?? null) !== normalizedActiveWorkspaceId) {
							devicePref = await prisma.userDevicePreference.update({
								where: { userId_deviceId: { userId, deviceId } },
								data: { activeWorkspaceId: normalizedActiveWorkspaceId },
							});
						}
						jsonResponse(res, 200, {
							userId: userPref.userId,
							deviceId: devicePref.deviceId,
							deleteAfterDays: formatDeleteAfterDays(userPref.deleteAfterDays),
							theme: devicePref.theme ?? null,
							language: devicePref.language ?? null,
							noteCardFontScale: normalizeFontScale(devicePref.noteCardFontScale),
							noteEditorFontScale: normalizeFontScale(devicePref.noteEditorFontScale),
							noteCardMaxHeightPx: Number.isFinite(Number(devicePref.noteCardMaxHeightPx))
								? Number(devicePref.noteCardMaxHeightPx)
								: null,
							activeWorkspaceId: normalizedActiveWorkspaceId,
							activeSharedFolder: normalizeActiveSharedFolder(devicePref.activeSharedFolder),
							checklistShowCompleted: Boolean(devicePref.checklistShowCompleted),
							quickDeleteChecklist: Boolean(devicePref.quickDeleteChecklist),
							noteCardCompletedExpandedByNoteId: devicePref.noteCardCompletedExpandedByNoteId || {},
							createdAt: fmt(devicePref.createdAt),
							updatedAt: fmt(devicePref.updatedAt),
							timezone: timezone || 'UTC',
						});
						return;
					}

					let pref = await prisma.$transaction(async (tx) => {
						const userPref = hasUserUpdates
							? await tx.userPreference.upsert({
								where: { userId },
								update: userUpdateData,
								create: {
									userId,
									deleteAfterDays: userUpdateData.deleteAfterDays ?? DEFAULT_DELETE_AFTER_DAYS,
								},
							})
							: await tx.userPreference.upsert({
								where: { userId },
								update: {},
								create: {
									userId,
									deleteAfterDays: DEFAULT_DELETE_AFTER_DAYS,
								},
							});

						let deviceData = { ...deviceUpdateData };
						const noteCardPatch = deviceData.__noteCardPatch;
						delete deviceData.__noteCardPatch;
						if (noteCardPatch) {
							const current = await tx.userDevicePreference.findUnique({
								where: { userId_deviceId: { userId, deviceId } },
								select: { noteCardCompletedExpandedByNoteId: true },
							});
							const existing = current?.noteCardCompletedExpandedByNoteId;
							const base = existing && typeof existing === 'object' ? existing : {};
							deviceData.noteCardCompletedExpandedByNoteId = {
								...base,
								[noteCardPatch.noteId]: noteCardPatch.expanded,
							};
						}

						const devicePref = hasDeviceUpdates
							? await tx.userDevicePreference.upsert({
								where: { userId_deviceId: { userId, deviceId } },
								update: deviceData,
								create: {
									userId,
									deviceId,
									theme: deviceData.theme ?? null,
									language: deviceData.language ?? null,
									noteCardFontScale:
										typeof deviceData.noteCardFontScale === 'number' ? deviceData.noteCardFontScale : 1,
									noteEditorFontScale:
										typeof deviceData.noteEditorFontScale === 'number' ? deviceData.noteEditorFontScale : 1,
									noteCardMaxHeightPx:
										typeof deviceData.noteCardMaxHeightPx === 'number' ? deviceData.noteCardMaxHeightPx : null,
									activeWorkspaceId: null,
									activeSharedFolder: deviceData.activeSharedFolder ?? null,
									checklistShowCompleted:
										typeof deviceData.checklistShowCompleted === 'boolean'
											? deviceData.checklistShowCompleted
											: false,
									quickDeleteChecklist:
										typeof deviceData.quickDeleteChecklist === 'boolean'
											? deviceData.quickDeleteChecklist
											: false,
									noteCardCompletedExpandedByNoteId:
										deviceData.noteCardCompletedExpandedByNoteId ?? {},
								},
							})
							: await tx.userDevicePreference.upsert({
								where: { userId_deviceId: { userId, deviceId } },
								update: {},
								create: {
									userId,
									deviceId,
									noteCardFontScale: 1,
									noteEditorFontScale: 1,
									checklistShowCompleted: false,
									quickDeleteChecklist: false,
									noteCardCompletedExpandedByNoteId: {},
								},
							});

						return { userPref, devicePref };
					});
					const normalizedActiveWorkspaceId = await resolveLiveWorkspaceId(
						prisma,
						userId,
						pref.devicePref.activeWorkspaceId ? String(pref.devicePref.activeWorkspaceId) : null,
					);
					if ((pref.devicePref.activeWorkspaceId ?? null) !== normalizedActiveWorkspaceId) {
						pref = {
							...pref,
							devicePref: await prisma.userDevicePreference.update({
								where: { userId_deviceId: { userId, deviceId } },
								data: { activeWorkspaceId: normalizedActiveWorkspaceId },
							}),
						};
					}

					console.info(
						`[api] POST /api/user/preferences updated:`,
						JSON.stringify({ userUpdateData, deviceUpdateData })
					);
					jsonResponse(res, 200, {
						userId: pref.userPref.userId,
						deviceId: pref.devicePref.deviceId,
						deleteAfterDays: formatDeleteAfterDays(pref.userPref.deleteAfterDays),
						theme: pref.devicePref.theme ?? null,
						language: pref.devicePref.language ?? null,
						noteCardFontScale: normalizeFontScale(pref.devicePref.noteCardFontScale),
						noteEditorFontScale: normalizeFontScale(pref.devicePref.noteEditorFontScale),
						noteCardMaxHeightPx: Number.isFinite(Number(pref.devicePref.noteCardMaxHeightPx))
							? Number(pref.devicePref.noteCardMaxHeightPx)
							: null,
						activeWorkspaceId: normalizedActiveWorkspaceId,
						activeSharedFolder: normalizeActiveSharedFolder(pref.devicePref.activeSharedFolder),
						checklistShowCompleted: Boolean(pref.devicePref.checklistShowCompleted),
						quickDeleteChecklist: Boolean(pref.devicePref.quickDeleteChecklist),
						noteCardCompletedExpandedByNoteId: pref.devicePref.noteCardCompletedExpandedByNoteId || {},
						createdAt: fmt(pref.devicePref.createdAt),
						updatedAt: fmt(pref.devicePref.updatedAt),
						timezone: timezone || 'UTC',
					});
				} catch (err) {
					console.error('[api] POST /api/user/preferences error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			})();
			return true;
		}

		// ── Not handled → fall through ───────────────────────────────────
		return false;
	}

	return handleRequest;
}

module.exports = { createPreferencesRouter, DEFAULT_DELETE_AFTER_DAYS, NEVER_DELETE_AFTER_DAYS };
