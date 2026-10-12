/**
 * Which Yjs rooms should be holding a live WebSocket right now.
 *
 * Pulled out of DocumentManager as a pure function on purpose. It is the only genuinely new
 * decision in the "connect what you are looking at" change, every rule in it exists to answer
 * a specific way this can feel wrong, and none of that is testable inside a class that needs a
 * browser, IndexedDB and a socket to exist. So: data in, decision out.
 *
 * The rules, and the question each one answers:
 *
 *   - **On screen wins, always, and is never capped.** Refusing to connect something the user
 *     is looking at would be the one unambiguous regression available here.
 *   - **The pinned room wins.** That is the note open in the editor. Ordinary interest is
 *     timestamped and expires, which for an editor session is actively wrong: leave a note
 *     open for a minute and its connection would close under the person typing into it.
 *   - **Interest decays, it is not forgotten instantly.** A room keeps its socket for
 *     `graceMs` after nothing wants it. This is what makes scrolling down and straight back up
 *     free — "what if someone scrolls the grid like a game" is a fair question, and the answer
 *     has to be "no handshakes", because the path serves only ~7 a second.
 *   - **The warm tail is capped.** Otherwise a long session arrives at one socket per note by
 *     a slower route, which is the exact thing being fixed (~96 sockets, ~20 s of a cold boot,
 *     against browser ceilings of ~200 in Firefox and ~255 in Chromium).
 *   - **Squeezed out is not the same as expired.** A room that did not fit under the cap keeps
 *     its interest entry: it is still recent, and it comes back into the pool as warmer rooms
 *     age out. Only genuinely stale entries are reported as expired.
 *
 * Note what is NOT here: registries, rooms with unsent local edits, and rooms with no local
 * content at all. Those connect for reasons that have nothing to do with attention, and
 * DocumentManager decides them separately — losing an offline edit because a note was
 * off-screen is a data bug, not a performance tradeoff, and it has no business being weighed
 * against a socket budget.
 */

export type ConnectionPoolInput = {
	/** Rooms on screen (plus whatever overscan the caller applies). Never evicted. */
	viewportRooms: Iterable<string>;
	/** The room open in the editor, held until explicitly released. */
	pinnedRoom?: string | null;
	/** Room -> the last time anything wanted it connected, as epoch ms. */
	interest: ReadonlyMap<string, number>;
	now: number;
	graceMs: number;
	/** Ceiling on warm (off-screen) rooms. The viewport and the pinned room are exempt. */
	maxWarm: number;
};

export type ConnectionPoolResult = {
	/** Rooms that should hold a socket. */
	pooled: Set<string>;
	/** Interest entries that have aged out and should be dropped by the caller. */
	expired: string[];
};

export function computeConnectionPool(input: ConnectionPoolInput): ConnectionPoolResult {
	const pooled = new Set<string>(input.viewportRooms);
	if (input.pinnedRoom) pooled.add(input.pinnedRoom);

	// Most recently wanted first, so the cap keeps the freshest rooms rather than whichever
	// ones happened to be inserted first.
	const candidates = Array.from(input.interest.entries())
		.filter(([roomName]) => !pooled.has(roomName))
		.sort((left, right) => right[1] - left[1]);

	const expired: string[] = [];
	const maxWarm = Math.max(0, input.maxWarm);
	let warm = 0;
	for (const [roomName, lastWantedAt] of candidates) {
		if (input.now - lastWantedAt > input.graceMs) {
			expired.push(roomName);
			continue;
		}
		if (warm >= maxWarm) continue;
		pooled.add(roomName);
		warm++;
	}

	return { pooled, expired };
}

/**
 * Where a room sits in the connect queue. Lower goes first.
 *
 * This is the load-bearing half of the whole change, and that is not obvious, so: the first
 * prod measurement showed sockets drop from ~96 to 16 while the number the user actually
 * experiences — how long until a collaborator's edit to the note they just opened appears —
 * barely moved, from "6-17 s, random" to "6-8 s, consistent". The handshake path serves about
 * 4.3 sockets a second, so a batch of 16 takes ~3.7 s to drain, and the queue was in arbitrary
 * order. **Queue LENGTH decides when the last room syncs. Queue POSITION decides when yours
 * does.** Only the second one is what somebody is sitting there waiting for.
 *
 * `connectProvidersStaggered` fires the first entry immediately and spreads the rest, so
 * whatever sorts first here pays one handshake and nothing else.
 *
 * Tiers, in order:
 *   0. the pinned room — the note open in the editor, the one unambiguous "waiting on this"
 *   1. what is on screen, in reading order from the top
 *   2. warm rooms, most recently wanted first (the recently-opened seed lands here, which is
 *      exactly where it belongs: worth having, never worth delaying a visible note for)
 *   3. anything else
 *
 * Recency is a SEPARATE sort key, not folded into the tier number. The first version of this
 * computed `100_000 - (lastWantedAt / 1000) % 99_999`, which wraps — epoch milliseconds do not
 * survive being squeezed into an arbitrary range, and the order it produced would have gone
 * wrong whenever the modulo rolled over. Hence a tuple and a two-key comparison.
 */
export type ConnectionRankInput = {
	pinnedRoom?: string | null;
	/** Room -> position on screen, top first. */
	viewportOrder: ReadonlyMap<string, number>;
	/** Room -> last time anything wanted it connected, epoch ms. */
	interest: ReadonlyMap<string, number>;
};

export type ConnectionRank = { tier: number; within: number };

export function connectionRank(roomName: string, input: ConnectionRankInput): ConnectionRank {
	if (input.pinnedRoom === roomName) return { tier: 0, within: 0 };
	const viewportIndex = input.viewportOrder.get(roomName);
	if (viewportIndex !== undefined) return { tier: 1, within: viewportIndex };
	const lastWantedAt = input.interest.get(roomName);
	if (lastWantedAt !== undefined) return { tier: 2, within: -lastWantedAt };
	return { tier: 3, within: 0 };
}

/** Negative when `left` should connect before `right`. Suitable for Array.prototype.sort. */
export function compareConnectionRank(left: string, right: string, input: ConnectionRankInput): number {
	const a = connectionRank(left, input);
	const b = connectionRank(right, input);
	return (a.tier - b.tier) || (a.within - b.within);
}
