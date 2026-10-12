/**
 * Which version of each note's content this device has actually shown you at full height.
 *
 * This exists to fix the third of the three data-delivery complaints: **cards changing size
 * while you look at them.** It got worse, not better, when sockets became viewport-driven —
 * before, every note synced during the first ~20 s of a cold boot, so height shifts happened
 * early and in bulk; now a note syncs when you scroll to it, so the shift happens *on arrival,
 * in front of you*. Less total movement, worse to experience. Reported on 1.21.7: "some note
 * height shifting happening when scrolling the grid".
 *
 * The fix is the one the user proposed, which is what Google Keep does: when a note's content
 * changes and you have not looked at it yet, **hold the card at the height it already had**,
 * mark it so you can see something changed, and only re-measure once you have opened it.
 *
 * ## Why `updatedAt` and not `lastAccessedAt`
 *
 * `lastAccessedAt` lives in shared Yjs metadata (`noteModel.ts`), so it cannot mean "since
 * *you* last looked" — your wife opening a note updates it for you too. `updatedAt` is also
 * shared, but that is correct here: it is a property of the content, not of a viewer. The
 * per-viewer half is this file, and it is deliberately **device-local**: "has this device shown
 * you this version" is a question about this screen, not about your account. A phone and a
 * desktop should each get their own chance to show you what changed.
 *
 * ## Seeding, and why it does the right thing on a cold boot
 *
 * A note with no entry here is recorded as seen at whatever `updatedAt` it currently has,
 * without being flagged. That sounds like it would defeat the whole purpose on the very boot
 * where it matters most — it does not, because of the order things happen in: the grid renders
 * from IndexedDB first (~400 ms), so the seed captures the **stale** timestamp, and the fresher
 * one arrives later over the socket and is correctly flagged as a change. The only case seeding
 * swallows is a note whose first ever appearance on this device is already current, where
 * nothing shifted and there is nothing to report.
 *
 * Pruned against the current workspace so it cannot grow without bound. Stores note ids and
 * timestamps only — no titles, no content — consistent with the privacy posture for the other
 * device-local caches.
 */

export type NoteContentSeenScope = {
	userId: string | null | undefined;
	deviceId: string | null | undefined;
};

export type NoteContentSeenMap = Readonly<Record<string, number>>;

const STORAGE_PREFIX = 'freemannotes.noteContentSeen.v1';

function storageKey(scope: NoteContentSeenScope): string | null {
	const userId = String(scope.userId || '').trim();
	const deviceId = String(scope.deviceId || '').trim();
	if (!userId || !deviceId) return null;
	return `${STORAGE_PREFIX}:${userId}::${deviceId}`;
}

const EMPTY: NoteContentSeenMap = Object.freeze({});

// Read on every render pass that needs it, so it is cached rather than re-parsed. Keyed by the
// storage key so switching user or device cannot serve the wrong map.
let cacheKey: string | null = null;
let cached: NoteContentSeenMap = EMPTY;

export function readNoteContentSeenState(scope: NoteContentSeenScope): NoteContentSeenMap {
	const key = storageKey(scope);
	if (!key) return EMPTY;
	if (cacheKey === key) return cached;
	if (typeof localStorage === 'undefined') {
		cacheKey = key;
		cached = EMPTY;
		return cached;
	}
	try {
		const raw = localStorage.getItem(key);
		const parsed = raw ? (JSON.parse(raw) as Record<string, unknown> | null) : null;
		const next: Record<string, number> = {};
		if (parsed && typeof parsed === 'object') {
			for (const [noteId, value] of Object.entries(parsed)) {
				if (typeof noteId !== 'string' || noteId.length === 0) continue;
				const timestamp = typeof value === 'number' && Number.isFinite(value) ? value : null;
				if (timestamp === null) continue;
				next[noteId] = timestamp;
			}
		}
		cacheKey = key;
		cached = next;
		return cached;
	} catch {
		cacheKey = key;
		cached = EMPTY;
		return cached;
	}
}

function write(scope: NoteContentSeenScope, next: Record<string, number>): void {
	const key = storageKey(scope);
	if (!key) return;
	cacheKey = key;
	cached = next;
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(next));
	} catch {
		// Best effort. Losing this costs one card holding its height when it did not need to,
		// or not holding when it could have — never content, never a sync.
	}
}

/** Record that this device has shown the user this note at this content version. */
export function markNoteContentSeen(scope: NoteContentSeenScope, noteId: string, updatedAt: number): void {
	const id = String(noteId || '').trim();
	if (!id) return;
	if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return;
	const current = readNoteContentSeenState(scope);
	if (current[id] === updatedAt) return;
	write(scope, { ...current, [id]: updatedAt });
}

/** Record several at once — used to seed notes this device has never tracked. */
export function markManyNoteContentSeen(
	scope: NoteContentSeenScope,
	entries: readonly { noteId: string; updatedAt: number }[]
): void {
	if (entries.length === 0) return;
	const current = readNoteContentSeenState(scope);
	let changed = false;
	const next: Record<string, number> = { ...current };
	for (const entry of entries) {
		const id = String(entry.noteId || '').trim();
		if (!id) continue;
		if (typeof entry.updatedAt !== 'number' || !Number.isFinite(entry.updatedAt)) continue;
		if (next[id] === entry.updatedAt) continue;
		next[id] = entry.updatedAt;
		changed = true;
	}
	if (changed) write(scope, next);
}

/** Drop entries for notes that are no longer present, so this cannot grow without bound. */
export function pruneNoteContentSeenState(scope: NoteContentSeenScope, keepNoteIds: Iterable<string>): void {
	const current = readNoteContentSeenState(scope);
	const keep = new Set<string>();
	for (const noteId of keepNoteIds) {
		const id = String(noteId || '').trim();
		if (id) keep.add(id);
	}
	// Never prune to empty off an empty keep-set: the grid's note list is empty before the
	// registry hydrates, and wiping the whole map there would flag every note as changed on
	// the next pass.
	if (keep.size === 0) return;
	const next: Record<string, number> = {};
	let removed = false;
	for (const [noteId, updatedAt] of Object.entries(current)) {
		if (keep.has(noteId)) next[noteId] = updatedAt;
		else removed = true;
	}
	if (removed) write(scope, next);
}

/** Must be called on logout — the next user on this device has no business seeing these. */
export function clearNoteContentSeenState(): void {
	cacheKey = null;
	cached = EMPTY;
	if (typeof localStorage === 'undefined') return;
	try {
		const doomed: string[] = [];
		for (let index = 0; index < localStorage.length; index++) {
			const key = localStorage.key(index);
			if (key && key.startsWith(STORAGE_PREFIX)) doomed.push(key);
		}
		for (const key of doomed) localStorage.removeItem(key);
	} catch {
		// ignore
	}
}

/** Test seam. Drops the in-memory cache so a fresh read hits storage again. */
export function resetNoteContentSeenCacheForTests(): void {
	cacheKey = null;
	cached = EMPTY;
}

// ─── The decision itself ─────────────────────────────────────────────────────

export type CardHoldInput = {
	/** The note's current shared content timestamp. */
	updatedAt: number;
	/** What this device last showed, or undefined if it has never tracked this note. */
	seenUpdatedAt: number | undefined;
	/** The card's last real measured height, or null if it has never been measured. */
	measuredHeightPx: number | null;
	/** True while this note is open in the editor. */
	isOpen: boolean;
};

export type CardHoldDecision = {
	/** Content changed since this device last showed it, and the card should say so. */
	changed: boolean;
	/** Clamp the card to this height, or null to let it size naturally. */
	holdHeightPx: number | null;
	/** This device has never tracked the note; the caller should seed it. */
	needsSeed: boolean;
};

const NO_HOLD: CardHoldDecision = { changed: false, holdHeightPx: null, needsSeed: false };

/**
 * Should this card hold its height, and should it be marked as changed?
 *
 * **The card is CLAMPED rather than mis-measured, and that distinction is load-bearing.**
 * CONTRIBUTING records that withholding a real measurement to stop a card moving broke
 * virtualization and drag in 1.11.1 — the virtualizer needs true heights. Returning
 * `holdHeightPx` means the card is rendered at exactly that height, so the ResizeObserver
 * measures the truth and the virtualizer is never lied to. The content is clipped; the
 * geometry is honest.
 */
export function resolveCardHold(input: CardHoldInput): CardHoldDecision {
	if (typeof input.updatedAt !== 'number' || !Number.isFinite(input.updatedAt)) return NO_HOLD;
	// Never hold the note the user is looking at. Opening it is how they catch up, and the
	// re-measure happens behind the editor overlay so the grid is correct by the time it is
	// closed again.
	if (input.isOpen) return NO_HOLD;
	if (input.seenUpdatedAt === undefined) return { changed: false, holdHeightPx: null, needsSeed: true };
	if (input.updatedAt <= input.seenUpdatedAt) return NO_HOLD;
	// Changed, but never measured: there is no height to hold and nothing has moved yet, so
	// there is nothing to warn about either. Let it render naturally.
	if (input.measuredHeightPx === null || !(input.measuredHeightPx > 0)) return NO_HOLD;
	return { changed: true, holdHeightPx: input.measuredHeightPx, needsSeed: false };
}
