/**
 * One-shot recovery for an attached drawing whose Yjs room we were refused.
 *
 * An attached drawing's room is gated by its own NoteCollaborator rows, which are written
 * by a single REST call at drawing-save time. Miss that call — be offline when the drawing
 * is attached, or join the note as a collaborator after the fact — and the collaborator's
 * websocket to the drawing room gets closed with 1008, at which point DocumentManager stops
 * retrying and tears the room down on purpose (a 1008 normally means "your access was
 * revoked", and retrying that forever is just noise).
 *
 * The queue in noteShareApi replays the dropped grant from the *author's* side, but the
 * reader has already been refused by then and won't ask again for the rest of the session.
 * So: when a drawing room is denied, ask the server once to reconcile access for that
 * drawing (the endpoint registers a non-editor caller as a collaborator on itself, which is
 * exactly why opening the drawing by hand used to "fix" the placeholder), then tell the card
 * to have another go.
 *
 * Deliberately NOT a general retry mechanism:
 *   - one attempt per room per session, enforced by `attemptedRooms`, so a reader who really
 *     has no business reading the drawing can't spin on it
 *   - armed only by an actual `loadDrawingDoc` call, and consumed only by an actual denial
 *
 * That bound is the whole point. `loadDrawingDoc` used to call the access-sync endpoint
 * unconditionally and it live-locked the app: upsert → workspace metadata event →
 * refreshNoteShareState → re-render → loadDrawingDoc → upsert → … Firing only on a real
 * denial, at most once, keeps that door shut.
 */

type ArmedRecovery = {
	parentNoteId: string;
	drawingId: string;
};

/** roomName → the (parent, drawing) pair that opened it. */
const armedRooms = new Map<string, ArmedRecovery>();
/** Rooms we have already spent our single recovery attempt on. */
const attemptedRooms = new Set<string>();
/** drawingId → card-level listeners waiting to re-render once access is sorted out. */
const recoveredListeners = new Map<string, Set<() => void>>();

/**
 * Record that `roomName` is being opened as an attached drawing, so a later denial can be
 * matched back to the note it hangs off. No-op once the room has had its one attempt.
 */
export function armAttachedDrawingAccessRecovery(roomName: string, parentNoteId: string, drawingId: string): void {
	const room = String(roomName || '').trim();
	const parent = String(parentNoteId || '').trim();
	const drawing = String(drawingId || '').trim();
	if (!room || !parent || !drawing) return;
	if (attemptedRooms.has(room)) return;
	armedRooms.set(room, { parentNoteId: parent, drawingId: drawing });
}

/**
 * Claim the recovery for a denied room. Returns null when the room was never armed or has
 * already been attempted — claiming it burns the attempt, so this can only ever fire once
 * per room per session.
 */
export function takeAttachedDrawingAccessRecovery(roomName: string): ArmedRecovery | null {
	const room = String(roomName || '').trim();
	if (!room) return null;
	const entry = armedRooms.get(room);
	if (!entry || attemptedRooms.has(room)) return null;
	attemptedRooms.add(room);
	armedRooms.delete(room);
	return entry;
}

/** Subscribe a note card to "access for this drawing has been reconciled, try again". */
export function subscribeAttachedDrawingAccessRecovered(drawingId: string, listener: () => void): () => void {
	const drawing = String(drawingId || '').trim();
	if (!drawing) return () => undefined;
	const existing = recoveredListeners.get(drawing) ?? new Set<() => void>();
	existing.add(listener);
	recoveredListeners.set(drawing, existing);
	return () => {
		const current = recoveredListeners.get(drawing);
		if (!current) return;
		current.delete(listener);
		if (current.size === 0) recoveredListeners.delete(drawing);
	};
}

export function notifyAttachedDrawingAccessRecovered(drawingId: string): void {
	const drawing = String(drawingId || '').trim();
	if (!drawing) return;
	for (const listener of recoveredListeners.get(drawing) ?? []) {
		try {
			listener();
		} catch {
			// A card that blew up on re-render shouldn't take the rest of the grid with it.
		}
	}
}

/** Must be called on logout — the attempt budget is per session, not per lifetime. */
export function resetAttachedDrawingAccessRecovery(): void {
	armedRooms.clear();
	attemptedRooms.clear();
	recoveredListeners.clear();
}
