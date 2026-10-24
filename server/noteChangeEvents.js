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
 * Coalescing means a single event can cover edits by SEVERAL people, so the event carries
 * `changedUserIds` - all of them, most recent first - and not just the last one. Reporting only
 * the last writer is information the server throws away that nothing downstream can recover.
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

/**
 * Metadata keys that move WITHOUT anything on the card changing.
 *
 * `lastAccessedAt` is written by simply OPENING a note (`markNoteAccessed`), and it lives in
 * shared Yjs metadata, so one person reading a note sends an update to everybody else. `updatedAt`
 * is stamped on every local transaction. Treating either as a change produced three reported bugs
 * at once: opening a note told your collaborator you had edited it, closing it told them again,
 * and refreshing the page told them a third time.
 */
const UNINTERESTING_METADATA_KEYS = new Set(['lastAccessedAt', 'updatedAt']);

/** Docs already being watched, so observers attach once per room rather than per update. */
const observedDocs = new WeakSet();
/** Set by those observers when something a card would DISPLAY actually changed. */
const meaningfulChangeFlags = new WeakMap();

/**
 * Watch a note document for changes that matter, and ignore the ones that do not.
 *
 * Observers rather than comparing snapshots, because Yjs already knows precisely which keys a
 * transaction touched - `event.keysChanged` is exactly the question being asked here. Hashing
 * content before and after would be both less accurate (equal-length edits) and far more
 * expensive (per keystroke, on documents up to a megabyte).
 */
function watchNoteDocForMeaningfulChanges(doc) {
	if (!doc || observedDocs.has(doc)) return;
	observedDocs.add(doc);
	const mark = () => meaningfulChangeFlags.set(doc, true);
	try {
		doc.getMap('metadata').observe((event) => {
			for (const key of event.keysChanged) {
				if (!UNINTERESTING_METADATA_KEYS.has(key)) {
					mark();
					return;
				}
			}
		});
		// Anything below is content by definition.
		doc.getText('title').observe(mark);
		doc.getText('content').observe(mark);
		doc.getXmlFragment('contentRich').observeDeep(mark);
		doc.getArray('checklist').observeDeep(mark);
		doc.getArray('drawingIds').observe(mark);
	} catch {
		// If observers cannot be attached, fall back to announcing every update rather than going
		// silent - a spurious chip is a smaller failure than a change nobody hears about.
		meaningfulChangeFlags.set(doc, true);
	}
}

/**
 * Did the update that just landed change anything worth telling anyone about?
 *
 * Consumes the flag, so each update is judged on its own.
 */
function consumeMeaningfulChange(doc) {
	if (!doc) return true;
	// Never watched means we cannot judge, so announce. Going silent on a real edit is a far worse
	// failure than a redundant chip, and this also removes any dependence on the observers having
	// been attached before the update was applied.
	if (!observedDocs.has(doc)) return true;
	const flagged = meaningfulChangeFlags.get(doc) === true;
	meaningfulChangeFlags.delete(doc);
	return flagged;
}

/**
 * Quiet period before a room's change is announced.
 *
 * Raised from 2.5s: a chip that appears while somebody is still mid-sentence is noise, and the
 * card itself is already updating live, so nothing is actually being withheld by waiting. 10s
 * means "they stopped typing" rather than "they paused to think".
 */
const NOTE_CHANGE_DEBOUNCE_MS = 10000;
/**
 * Announce at least this often during continuous editing, so a long burst still reports.
 *
 * The ceiling exists because somebody typing without pause never trips the debounce at all. A
 * minute is the most anyone should wait to hear that a note is being worked on.
 */
const NOTE_CHANGE_MAX_WAIT_MS = 60_000;
const { createNoteRecipientResolver, MEMBER_CACHE_TTL_MS } = require('./noteRecipients');

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
	/**
	 * Monotonic tick, used to order the actors in a burst.
	 *
	 * NOT `Date.now()`: several updates routinely land inside the same millisecond, which makes a
	 * timestamp sort a tie and silently falls back to insertion order - so the chips would be drawn
	 * oldest-first exactly when edits arrive fastest. A counter is ordered by construction.
	 */
	let actorSequence = 0;
	/**
	 * These rules now live in noteRecipients.js, because the media router needed the same ones and
	 * did not have them - every image, document, link preview and OCR tick was published with no
	 * recipient list at all, which the broadcaster reads as "send to everyone". Two copies of a
	 * fail-closed rule drift, and that drift IS the bug, so there is one copy.
	 */
	const recipients = createNoteRecipientResolver({ prisma, ttlMs: MEMBER_CACHE_TTL_MS });

	async function flush(docName) {
		const entry = pending.get(docName);
		if (!entry) return;
		pending.delete(docName);
		if (entry.timer) clearTimeout(entry.timer);
		if (entry.maxTimer) clearTimeout(entry.maxTimer);
		if (!emit) return;

		// A failed lookup is not an empty one. No recipient list means no event, because an empty
		// userIds field broadcasts to every connected client and would leak the note id.
		//
		// The registry is not a note and has no collaborators of its own, so only a note-changed
		// event asks for them.
		const userIds = await recipients.resolveRecipients({
			workspaceId: entry.workspaceId,
			docId: docName,
			includeCollaborators: entry.reason === 'note-changed',
		});
		if (!userIds) return;

		// Most recent first, which is the order the card's chips are drawn in.
		const changedUserIds = [...entry.actors.entries()]
			.sort((left, right) => right[1].seq - left[1].seq)
			.map(([actorId]) => actorId);

		emit({
			reason: entry.reason,
			workspaceId: entry.workspaceId,
			docId: docName,
			// Kept as the most recent actor so anything reading the singular field still works.
			changedUserId: changedUserIds[0] ?? null,
			changedUserIds,
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
			// EVERY actor in the burst, not just the latest.
			//
			// This used to be `existing.userId = userId` - last writer wins - which was fine while
			// a client could only remember one editor per note. It is not fine now that cards show
			// a chip per person: with a 10s debounce and a 60s ceiling, two people editing the same
			// note anywhere near each other coalesce into ONE event, and attributing it to whoever
			// happened to type last silently deleted the other one. Reported from a real
			// three-user test: C saw a chip for one of A and B, never both.
			existing.actors.set(userId, { at: now, seq: ++actorSequence });
			existing.reason = reason;
			existing.lastAt = now;
			if (existing.timer) clearTimeout(existing.timer);
			existing.timer = setTimeout(() => { void flush(docName); }, debounceMs);
			if (existing.timer.unref) existing.timer.unref();
			return;
		}

		const entry = {
			/** userId -> the last moment they touched it in this burst, and in what order. */
			actors: new Map([[userId, { at: now, seq: ++actorSequence }]]),
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
		recipients.clear();
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
	watchNoteDocForMeaningfulChanges,
	consumeMeaningfulChange,
	parseRoomName,
	classifyRoom,
	NOTE_CHANGE_DEBOUNCE_MS,
	NOTE_CHANGE_MAX_WAIT_MS,
};
