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
//
// Three surfaces, three jobs — keep them straight when adding a new event:
//   • the notification bell  — only things the user owes an answer to (a pending
//     invitation). It empties as they act, and nothing informational goes in it.
//   • the inbox              — the durable log of everything that happened. Cards
//     are never removed automatically; only the user clears them.
//   • push                   — addressed to you, worth a buzz. Mentions and shares,
//     never "someone accepted the thing you sent them".
// An event that lands in two of those reads to the user as duplicate notifications,
// which is exactly the confusion this split exists to kill.
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
 * @property {string[]} [hiddenTargetUserIds] — Users the event concerns but who may not see it yet
 *                                              (visible=false; revealed by revealInvitationActivity)
 * @property {string[]} [readUserIds]        — Targets whose copy starts already-read. Use for the person
 *                                              who performed the action: telling you what you just did
 *                                              is a log entry, not an unread notification.
 */

/**
 * Emits a single activity event: writes the Activity row and all
 * ActivityTarget rows inside one Prisma transaction.
 *
 * Returns null if there are no targets at all (nothing to emit).
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
		hiddenTargetUserIds = [],
		readUserIds = [],
	} = payload;

	const visibleTargets = [...new Set(targetUserIds.filter(Boolean))];
	const hiddenTargets = [...new Set(hiddenTargetUserIds.filter(Boolean))]
		.filter((userId) => !visibleTargets.includes(userId));
	if (visibleTargets.length === 0 && hiddenTargets.length === 0) return null;

	const preRead = new Set(readUserIds.filter(Boolean));

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
			data: [
				...visibleTargets.map((userId) => ({ activityId: created.id, userId, visible: true })),
				...hiddenTargets.map((userId) => ({ activityId: created.id, userId, visible: false })),
			],
			skipDuplicates: true,
		});

		const preReadTargets = [...visibleTargets, ...hiddenTargets].filter((userId) => preRead.has(userId));
		if (preReadTargets.length > 0) {
			await tx.activityRead.createMany({
				data: preReadTargets.map((userId) => ({ activityId: created.id, userId })),
				skipDuplicates: true,
			});
		}

		return created;
	});

	return activity.id;
}

/**
 * Reveals the inbox cards that were held back while an invitation sat unanswered.
 *
 * Two kinds get held: the `mention` (or `assignment_created`) activity that caused an
 * implicit invitation — it carries snapshot.invitationId — and the `note_shared`
 * activity from a direct share, which carries it too since the inbox redesign. Once
 * the recipient accepts, that original card is exactly the right thing to show them:
 * a mention deep-links straight to its chip in the note, a share opens the note.
 *
 * Only called on accept. A decline leaves them hidden forever — un-hiding a card that
 * says "Alice mentioned you" and opens a note you just refused access to is worse than
 * showing nothing, so the decline gets its own card instead.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ userId: string, invitationId: string, docId: string }} params
 * @returns {Promise<string[]>} IDs of the activities revealed.
 */
async function revealInvitationActivity(prisma, { userId, invitationId, docId }) {
	const activities = await prisma.activity.findMany({
		where: {
			targets: { some: { userId, visible: false } },
			OR: [
				{ snapshot: { path: ['invitationId'], equals: invitationId } },
				{ kind: 'note_shared', sourceDocId: docId },
			],
		},
		select: { id: true },
	});
	if (activities.length === 0) return [];
	const activityIds = activities.map((a) => a.id);
	await prisma.activityTarget.updateMany({
		where: { userId, activityId: { in: activityIds } },
		data: { visible: true },
	});
	return activityIds;
}

/**
 * Convenience wrapper: emits a note_shared activity when a note is shared
 * with a registered user. No-ops if inviteeUserId is null (email-only invite).
 *
 * The card starts hidden: until the invitee answers, this share belongs in their
 * notification bell and nowhere else.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ actorId: string, inviteeUserId: string | null, invitationId?: string | null, sourceDocId: string, sourceWorkspaceId: string, sourceNoteId: string, noteTitle?: string | null }} params
 * @returns {Promise<string | null>}
 */
async function emitNoteSharedActivity(prisma, {
	actorId,
	inviteeUserId,
	invitationId = null,
	sourceDocId,
	sourceWorkspaceId,
	sourceNoteId,
	noteTitle = null,
}) {
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
		snapshot: { invitationId: invitationId || null, noteTitle: noteTitle || null },
		targetUserIds: [],
		hiddenTargetUserIds: [inviteeUserId],
	});
}

/**
 * Convenience wrapper: emits a note_share_accepted activity when a recipient
 * accepts a note share invitation.
 *
 * Inviter-only, and deliberately not pushed. An acceptance is expected news, not
 * something worth buzzing a phone over — the inbox badge is the right loudness.
 * The recipient doesn't get a copy of this one; their own original mention/share
 * card is revealed instead (see revealInvitationActivity).
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

/**
 * Emits one of the "access changed" activities that both parties see: a decline,
 * a revoke, or a recipient leaving a shared note.
 *
 * Both sides get a card, because both sides' view of who can see this note just
 * changed, and an access change with no record is exactly the thing people come
 * back asking about months later ("when did I lose access to this?"). The person
 * who performed it gets theirs pre-read — you don't need an unread badge to tell
 * you what you just clicked.
 *
 * `openable` says whether the card should try to open the note when clicked. After
 * a decline or a revoke the recipient has nothing to open, so their card is inert.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ kind: string, actorId: string, otherUserId: string, sourceDocId: string, sourceWorkspaceId: string, sourceNoteId: string, noteTitle?: string | null, openable?: boolean }} params
 * @returns {Promise<string | null>}
 */
async function emitShareAccessChangedActivity(prisma, {
	kind,
	actorId,
	otherUserId,
	sourceDocId,
	sourceWorkspaceId,
	sourceNoteId,
	noteTitle = null,
	openable = true,
}) {
	if (!actorId || !otherUserId) return null;
	return emitActivity(prisma, {
		kind,
		actorId,
		sourceDocId,
		sourceWorkspaceId,
		sourceNoteId,
		subjectType: 'note',
		subjectId: sourceNoteId,
		deepLink: openable ? { kind: 'note' } : { kind: 'none' },
		snapshot: { noteTitle: noteTitle || null },
		targetUserIds: [actorId, otherUserId],
		readUserIds: [actorId],
	});
}

module.exports = {
	emitActivity,
	revealInvitationActivity,
	emitNoteSharedActivity,
	emitNoteShareAcceptedActivity,
	emitShareAccessChangedActivity,
};
