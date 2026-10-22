import * as Y from 'yjs';

/**
 * Who created a note, and who put it in the trash.
 *
 * ## Why these live ON the note rather than arriving separately
 *
 * The *fact* that a note was created or trashed travels through Yjs - it is part of the note, so it
 * arrives whenever it arrives and works offline. The *actor* used to travel only on a
 * `/ws/metadata` event that is debounced 10s server-side and carries NO note ids, which left the
 * client matching the two up by time. That produced three separate bugs:
 *
 * - a note you made on one device was hidden behind a prompt on your other device for ten seconds,
 *   because no actor had arrived yet and an unattributed change counts as somebody else's;
 * - a tombstone for a revoked share was silently discarded, because the device's own registry write
 *   made the server name *you* as the actor;
 * - a tombstone for a collaborator's deletion was discarded 757ms after appearing, for the same
 *   reason - those "you did something" events fire several times a session.
 *
 * Carrying the actor on the note removes the matching problem instead of tuning it: the answer is
 * per-note by construction, it arrives with the change, it survives a reload, and it is identical
 * on fibre and on a phone with two bars. See PROJECT_PHILOSOPHY.md, "A Hardcoded Time Window Is
 * Usually A Missing Piece Of Data".
 *
 * ## Deliberately no field for permanent deletion
 *
 * Once a note's document is destroyed there is nothing left to read, and making the write flush
 * first would need a timer - the thing this is removing. Permanent deletion keeps the old path.
 *
 * ## Deliberately its own module
 *
 * Same reason as `pendingNoteChanges.ts`: it imports nothing but Yjs, so the rules are testable in
 * plain Node. `noteModel.ts` cannot be - its import chain reaches React components and CSS modules,
 * which is why there has never been a unit test for it. These field names are the wire contract
 * across every client, so they are the last thing that should be untestable.
 *
 * `noteModel` re-exports all of this, so callers keep importing from there.
 *
 * ## Privacy
 *
 * Both fields sit in the note's SHARED document, so anybody with access to the note can read them.
 * That is the same exposure as the collaborator list and the attribution events that already exist,
 * so it adds no new disclosure - but it is a deliberate choice, not an accident.
 */
export const NOTE_CREATED_BY_FIELD = 'createdByUserId';
export const NOTE_TRASHED_BY_FIELD = 'trashedByUserId';

/** A usable id, or null for anything blank, absent or the wrong type. */
function normalizeActorId(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function readActorField(doc: Y.Doc, field: string): string | null {
	return normalizeActorId(doc.getMap<unknown>('metadata').get(field));
}

/**
 * Stamp the note's author. Called once, at creation, by whoever knows the signed-in user.
 *
 * A blank id writes nothing at all rather than writing null: an absent field already means
 * "unknown", and a note created while signed out should be indistinguishable from one made before
 * this field existed, rather than asserting that nobody made it.
 */
export function setNoteCreatedBy(doc: Y.Doc, userId: string | null | undefined, origin?: symbol): void {
	const actor = normalizeActorId(userId);
	if (!actor) return;
	const run = (): void => { doc.getMap<unknown>('metadata').set(NOTE_CREATED_BY_FIELD, actor); };
	if (origin) doc.transact(run, origin);
	else doc.transact(run);
}

/** Who created this note, or null for a legacy note / one made while signed out. */
export function readNoteCreatedBy(doc: Y.Doc): string | null {
	return readActorField(doc, NOTE_CREATED_BY_FIELD);
}

/** Who last moved this note to the trash, or null if unknown. Cleared on restore. */
export function readNoteTrashedBy(doc: Y.Doc): string | null {
	return readActorField(doc, NOTE_TRASHED_BY_FIELD);
}

/**
 * Record (or clear) who trashed a note, into a metadata map the caller is already writing.
 *
 * Takes the map rather than the doc so it joins the caller's EXISTING transaction. That is the
 * property the whole design depends on: a receiving client must never see `trashed` flip to true in
 * one update and learn who did it in another, because then it is back to guessing in between.
 *
 * Clearing on restore matters too - a stale name left behind would let a later tombstone credit
 * somebody who had nothing to do with it.
 */
export function writeNoteTrashedBy(
	metadata: Y.Map<unknown>,
	trashed: boolean,
	actorUserId?: string | null
): void {
	if (!trashed) {
		metadata.set(NOTE_TRASHED_BY_FIELD, null);
		return;
	}
	const actor = normalizeActorId(actorUserId);
	// No actor means the caller had nobody to name; leave whatever is there rather than blanking a
	// name a better-informed caller already recorded.
	if (actor) metadata.set(NOTE_TRASHED_BY_FIELD, actor);
}
