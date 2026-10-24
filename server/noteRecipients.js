'use strict';

/**
 * Who is allowed to hear that something happened to a note.
 *
 * ## Why this is its own module
 *
 * These rules existed once, inside `createNoteChangeNotifier`, and the media router did not have
 * them - so every image upload, document upload, link preview and OCR tick published an event with
 * no recipient list at all. An empty `userIds` means "no filter" to the broadcaster, so those
 * events went to **every connected client on the server**, carrying `workspaceId:noteId` for a note
 * most of them had no access to.
 *
 * The note-change path had been hardened against exactly that, with a comment saying so. The media
 * path simply never got the same treatment. Two copies of a fail-closed rule would have drifted
 * again, so now there is one.
 *
 * ## Fail CLOSED, always
 *
 * "Nobody extra" and "we could not find out" must never collapse into the same answer. A failed
 * lookup returns null, and the caller is expected to publish nothing - because the alternative is
 * an empty recipient list, which is the broadcast this module exists to prevent. Silence is
 * recoverable: the next event, reconnect or refresh fixes it. A leak is not.
 *
 * ## Caching
 *
 * Membership and collaborator lists change rarely and this runs on every media mutation, so both
 * are cached briefly. The TTL is short enough that a revoked collaborator stops hearing about a
 * note within seconds, and the revoke path pushes its own event immediately anyway.
 */

/** Membership rarely changes and this runs per event, so a short cache is plenty. */
const MEMBER_CACHE_TTL_MS = 30_000;

/**
 * @param {object} options
 * @param {object|null} options.prisma
 * @param {number} [options.ttlMs]
 */
function createNoteRecipientResolver({ prisma = null, ttlMs = MEMBER_CACHE_TTL_MS } = {}) {
	/** workspaceId -> { userIds, expiresAt } */
	const memberCache = new Map();
	/** docId -> { userIds, expiresAt } */
	const collaboratorCache = new Map();

	/**
	 * Everyone in a workspace. Null means the lookup FAILED and the caller must publish nothing.
	 */
	async function workspaceMemberIds(workspaceId) {
		if (!workspaceId) return null;
		const cached = memberCache.get(workspaceId);
		if (cached && cached.expiresAt > Date.now()) return cached.userIds;
		if (!prisma) return null;
		try {
			const rows = await prisma.workspaceMember.findMany({
				where: { workspaceId },
				select: { userId: true },
			});
			const userIds = rows.map((row) => String(row.userId)).filter(Boolean);
			memberCache.set(workspaceId, { userIds, expiresAt: Date.now() + ttlMs });
			return userIds;
		} catch {
			// Fail closed - see the note at the top.
			return null;
		}
	}

	/**
	 * Active collaborators on one note. `[]` means there are none; null means the lookup FAILED,
	 * and the caller treats those differently.
	 *
	 * `revokedAt: null` matters - access is taken away by setting it, and the row stays. Omitting
	 * it would keep telling an ex-collaborator about a note they can no longer open.
	 */
	async function noteCollaboratorIds(docId) {
		if (!docId) return [];
		const cached = collaboratorCache.get(docId);
		if (cached && cached.expiresAt > Date.now()) return cached.userIds;
		// No prisma yields "nobody extra" rather than a failure here, matching the behaviour this
		// was extracted from: a note with no collaborator table to consult still has its workspace
		// members, and those are resolved separately and do fail closed.
		if (!prisma) return [];
		try {
			const rows = await prisma.noteCollaborator.findMany({
				where: { docId, revokedAt: null },
				select: { userId: true },
			});
			const userIds = rows.map((row) => String(row.userId)).filter(Boolean);
			collaboratorCache.set(docId, { userIds, expiresAt: Date.now() + ttlMs });
			return userIds;
		} catch {
			return null;
		}
	}

	/**
	 * The full recipient list for an event about one note.
	 *
	 * Returns null when anything could not be determined, or when the result would be empty -
	 * both of which must stop the caller publishing, because an empty `userIds` is a broadcast.
	 *
	 * `includeCollaborators` is false for registry events: the notes registry is not a note and
	 * has no collaborators of its own, so asking would be meaningless.
	 */
	async function resolveRecipients({ workspaceId, docId, includeCollaborators = true }) {
		const memberIds = await workspaceMemberIds(workspaceId);
		if (!memberIds) return null;
		const recipients = new Set(memberIds);
		if (includeCollaborators) {
			const collaboratorIds = await noteCollaboratorIds(docId);
			if (!collaboratorIds) return null;
			for (const userId of collaboratorIds) recipients.add(userId);
		}
		if (recipients.size === 0) return null;
		return [...recipients];
	}

	/** Drop everything cached. Used on dispose, and by tests that do not want a warm cache. */
	function clear() {
		memberCache.clear();
		collaboratorCache.clear();
	}

	return { workspaceMemberIds, noteCollaboratorIds, resolveRecipients, clear };
}

module.exports = {
	MEMBER_CACHE_TTL_MS,
	createNoteRecipientResolver,
};
