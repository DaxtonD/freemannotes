'use strict';

/**
 * "This note changed, and here is who changed it."
 *
 * The one signal the grid needs in order to tell YOUR change from SOMEBODY ELSE'S. Everything in
 * phase 2 of the delivery work rests on it: whether a new note merges silently or waits behind the
 * pill, whether a card gets a collaborator chip, and what the pill counts.
 *
 * ## Why this exists at all
 *
 * The question "is this note mine" cannot be answered from the data. Note metadata has no author
 * field, and workspace shape tells you nothing - a Personal workspace can hold accepted shares and
 * have collaborators, shared notes move between workspaces, and whole workspaces get shared. So
 * the only reliable question is "who made this change", and the only place that is known is the
 * socket the change arrived on. `server.js` already records it for mention attribution via
 * `persistAdapter.recordDocUpdate(docName, userId)`; this turns the same fact into something
 * clients can see.
 *
 * ## Debouncing is mandatory, not an optimisation
 *
 * The hook fires on EVERY Yjs update, which is every keystroke. Emitting per update would flood
 * `/ws/metadata` and run a membership query per character typed. So changes coalesce per room:
 *
 * - **Trailing edge**, so a burst of typing produces one event when the typist pauses, rather than
 *   one at the start while they are still going.
 * - **With a maximum wait**, because somebody typing continuously for two minutes never pauses,
 *   and without it the event would never fire at all.
 *
 * ## Who receives it
 *
 * Workspace members. The `userIds` field on the event is a recipient filter, and leaving it empty
 * means "send to every connected client" - which would hand a note id and workspace id to people
 * with no access. So if the membership lookup fails we emit NOTHING rather than fall back to
 * broadcasting. Failing closed is the only safe direction here.
 *
 * Recipients are workspace members **plus the note's own collaborators**. Members alone is not
 * enough, and that was measured rather than assumed: of 27 shared notes in the dev database,
 * **27** had somebody with access who was not a member of the owning workspace. A shared note
 * lives in its OWNER's workspace, so the people a collaborator chip would be about are almost
 * never members of it. Members-only would have meant the chips never working on exactly the notes
 * they exist for.
 *
 * Collaborators are revoked by setting `revokedAt`, not by deleting the row, so that filter is
 * load-bearing: without it somebody whose access was taken away would carry on being told when
 * the note changes.
 *
 * The notes registry is the exception - it goes to members only. A collaborator on one note has no
 * business being told that the workspace's note LIST changed.
 */

/** Quiet period before a room's change is announced. */
const NOTE_CHANGE_DEBOUNCE_MS = 2500;
/** Announce at least this often during continuous editing, so a long burst still reports. */
const NOTE_CHANGE_MAX_WAIT_MS = 10_000;
/** Membership rarely changes and this runs per burst, so a short cache is plenty. */
const MEMBER_CACHE_TTL_MS = 30_000;

const NOTES_REGISTRY_SUFFIX = '__notes_registry__';

/**
 * Split `<workspaceId>:<noteId>` without tripping over ids that contain a colon.
 * Returns null for anything that is not a workspace-scoped room.
 */
function parseRoomName(docName) {
	const name = String(docName || '');
	if (!name || name.startsWith('markup:')) return null;
	const separator = name.indexOf(':');
	if (separator <= 0) return null;
	const workspaceId = name.slice(0, separator);
	const rest = name.slice(separator + 1);
	if (!workspaceId || !rest) return null;
	return { workspaceId, rest };
}

/**
 * Which kind of change is this?
 *
 * The notes registry is not a note, but its changes are exactly how a note being ADDED or REMOVED
 * shows up - so it gets its own reason rather than being skipped. The other registries
 * (collections, labels) do not affect which cards exist, so they are ignored.
 */
function classifyRoom(rest) {
	if (rest === NOTES_REGISTRY_SUFFIX) return 'note-order-changed';
	if (rest.startsWith('__') && rest.endsWith('__')) return null;
	return 'note-changed';
}

function createNoteChangeNotifier(options = {}) {
	const prisma = options.prisma || null;
	const emit = typeof options.emit === 'function' ? options.emit : null;
	const debounceMs = Number(options.debounceMs) || NOTE_CHANGE_DEBOUNCE_MS;
	const maxWaitMs = Number(options.maxWaitMs) || NOTE_CHANGE_MAX_WAIT_MS;

	/** docName -> pending announcement */
	const pending = new Map();
	/** workspaceId -> { userIds, expiresAt } */
	const memberCache = new Map();
	/** docName -> { userIds, expiresAt } */
	const collaboratorCache = new Map();

	async function readWorkspaceMemberIds(workspaceId) {
		const cached = memberCache.get(workspaceId);
		if (cached && cached.expiresAt > Date.now()) return cached.userIds;
		if (!prisma) return null;
		try {
			const rows = await prisma.workspaceMember.findMany({
				where: { workspaceId },
				select: { userId: true },
			});
			const userIds = rows.map((row) => String(row.userId)).filter(Boolean);
			memberCache.set(workspaceId, { userIds, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS });
			return userIds;
		} catch {
			// Fail closed - see the note on recipients above.
			return null;
		}
	}

	/**
	 * Active collaborators on one note. Returns [] when there are none, and null only when the
	 * lookup FAILED - the caller treats those differently, because "nobody extra" and "we do not
	 * know" must not collapse into the same answer.
	 */
	async function readNoteCollaboratorIds(docName) {
		const cached = collaboratorCache.get(docName);
		if (cached && cached.expiresAt > Date.now()) return cached.userIds;
		if (!prisma) return [];
		try {
			const rows = await prisma.noteCollaborator.findMany({
				// revokedAt is how access is taken away; the row stays. Omitting this would keep
				// telling an ex-collaborator about a note they can no longer open.
				where: { docId: docName, revokedAt: null },
				select: { userId: true },
			});
			const userIds = rows.map((row) => String(row.userId)).filter(Boolean);
			collaboratorCache.set(docName, { userIds, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS });
			return userIds;
		} catch {
			return null;
		}
	}

	async function flush(docName) {
		const entry = pending.get(docName);
		if (!entry) return;
		pending.delete(docName);
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.maxTimer) clearTimeout(entry.maxTimer);
		if (!emit) return;

		const memberIds = await readWorkspaceMemberIds(entry.workspaceId);
		// A failed lookup is not an empty one. No recipient list means no event, because an empty
		// userIds field broadcasts to every connected client and would leak the note id.
		if (!memberIds) return;

		const recipients = new Set(memberIds);
		if (entry.reason === 'note-changed') {
			const collaboratorIds = await readNoteCollaboratorIds(docName);
			if (!collaboratorIds) return;
			for (const userId of collaboratorIds) recipients.add(userId);
		}
		if (recipients.size === 0) return;
		const userIds = [...recipients];

		emit({
			reason: entry.reason,
			workspaceId: entry.workspaceId,
			docId: docName,
			changedUserId: entry.userId,
			userIds,
			occurredAt: new Date(entry.lastAt).toISOString(),
		});
	}

	/**
	 * Called for every authenticated Yjs update. Cheap and synchronous - the work happens on the
	 * trailing edge.
	 */
	function recordChange(docName, userId) {
		if (!emit || !docName || !userId) return;
		const parsed = parseRoomName(docName);
		if (!parsed) return;
		const reason = classifyRoom(parsed.rest);
		if (!reason) return;

		const now = Date.now();
		const existing = pending.get(docName);
		if (existing) {
			// Last writer wins for attribution: whoever most recently touched it is who the chip
			// should name.
			existing.userId = userId;
			existing.reason = reason;
			existing.lastAt = now;
			if (existing.timer) clearTimeout(existing.timer);
			existing.timer = setTimeout(() => { void flush(docName); }, debounceMs);
			if (existing.timer.unref) existing.timer.unref();
			return;
		}

		const entry = {
			userId,
			reason,
			workspaceId: parsed.workspaceId,
			firstAt: now,
			lastAt: now,
			timer: setTimeout(() => { void flush(docName); }, debounceMs),
			// The ceiling. Without it, continuous typing resets the debounce forever and the
			// change is never announced.
			maxTimer: setTimeout(() => { void flush(docName); }, maxWaitMs),
		};
		if (entry.timer.unref) entry.timer.unref();
		if (entry.maxTimer.unref) entry.maxTimer.unref();
		pending.set(docName, entry);
	}

	function dispose() {
		for (const entry of pending.values()) {
			if (entry.timer) clearTimeout(entry.timer);
			if (entry.maxTimer) clearTimeout(entry.maxTimer);
		}
		pending.clear();
		memberCache.clear();
		collaboratorCache.clear();
	}

	return {
		recordChange,
		dispose,
		// Exposed for the test harness so it does not have to wait out real timers.
		_flushNow: flush,
		_pendingCount: () => pending.size,
	};
}

module.exports = {
	createNoteChangeNotifier,
	parseRoomName,
	classifyRoom,
	NOTE_CHANGE_DEBOUNCE_MS,
	NOTE_CHANGE_MAX_WAIT_MS,
};
