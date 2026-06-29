'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// activityEmitter – server-side activity event emission.
//
// All collaborative actions that produce inbox entries go through emitActivity().
// The function writes an Activity row + ActivityTarget rows in a single
// transaction and returns the created activity ID. Callers are responsible for
// broadcasting the 'inbox-updated' workspace metadata event afterward.
//
// Activity records are immutable. Read/archive state lives in ActivityRead.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ActivityPayload
 * @property {string} kind                   — Activity kind string ('mention' | 'assignment_created' | etc.)
 * @property {string | null} actorId         — userId of the person who caused the event (null for system)
 * @property {string} sourceDocId            — Yjs room docId (e.g. "workspaceId:noteId")
 * @property {string} sourceWorkspaceId      — UUID of the source workspace
 * @property {string} sourceNoteId           — UUID of the source note
 * @property {string} subjectType            — 'note' | 'checklist_item'
 * @property {string} subjectId              — noteId or checklistItemId
 * @property {Object} deepLink               — Navigation target (see DeepLink union below)
 * @property {Object | null} [snapshot]      — { text, beforeText, afterText } captured at emission
 * @property {string[]} targetUserIds        — Users who should see this in their inbox
 */

/**
 * Emits a single activity event: writes the Activity row and all
 * ActivityTarget rows inside one Prisma transaction.
 *
 * Returns null if targetUserIds is empty (nothing to emit).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {ActivityPayload} payload
 * @returns {Promise<string | null>} Created activity ID, or null.
 */
async function emitActivity(prisma, payload) {
	const {
		kind,
		actorId = null,
		sourceDocId,
		sourceWorkspaceId,
		sourceNoteId,
		subjectType,
		subjectId,
		deepLink,
		snapshot = null,
		targetUserIds = [],
	} = payload;

	const validTargets = [...new Set(targetUserIds.filter(Boolean))];
	if (validTargets.length === 0) return null;

	const activity = await prisma.$transaction(async (tx) => {
		const created = await tx.activity.create({
			data: {
				kind,
				actorId: actorId || null,
				sourceDocId,
				sourceWorkspaceId,
				sourceNoteId,
				subjectType,
				subjectId,
				deepLink,
				snapshot: snapshot || undefined,
			},
			select: { id: true },
		});

		await tx.activityTarget.createMany({
			data: validTargets.map((userId) => ({
				activityId: created.id,
				userId,
			})),
			skipDuplicates: true,
		});

		return created;
	});

	return activity.id;
}

/**
 * Convenience wrapper: emits a note_shared activity when a note is shared
 * with a registered user. No-ops if inviteeUserId is null (email-only invite).
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ actorId: string, inviteeUserId: string | null, sourceDocId: string, sourceWorkspaceId: string, sourceNoteId: string }} params
 * @returns {Promise<string | null>}
 */
async function emitNoteSharedActivity(prisma, { actorId, inviteeUserId, sourceDocId, sourceWorkspaceId, sourceNoteId }) {
	if (!inviteeUserId) return null;
	return emitActivity(prisma, {
		kind: 'note_shared',
		actorId,
		sourceDocId,
		sourceWorkspaceId,
		sourceNoteId,
		subjectType: 'note',
		subjectId: sourceNoteId,
		deepLink: { kind: 'note' },
		snapshot: null,
		targetUserIds: [inviteeUserId],
	});
}

/**
 * Convenience wrapper: emits a note_share_accepted activity when a recipient
 * accepts a note share invitation.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ actorId: string, inviterUserId: string, sourceDocId: string, sourceWorkspaceId: string, sourceNoteId: string, noteTitle?: string | null }} params
 * @returns {Promise<string | null>}
 */
async function emitNoteShareAcceptedActivity(prisma, { actorId, inviterUserId, sourceDocId, sourceWorkspaceId, sourceNoteId, noteTitle }) {
	return emitActivity(prisma, {
		kind: 'note_share_accepted',
		actorId,
		sourceDocId,
		sourceWorkspaceId,
		sourceNoteId,
		subjectType: 'note',
		subjectId: sourceNoteId,
		deepLink: { kind: 'note' },
		snapshot: noteTitle ? { noteTitle } : null,
		targetUserIds: [inviterUserId],
	});
}

module.exports = {
	emitActivity,
	emitNoteSharedActivity,
	emitNoteShareAcceptedActivity,
};
