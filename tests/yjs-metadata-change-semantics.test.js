'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// The Yjs fact that NoteGrid's trashed-detection rests on.
//
// This exists because of a real bug, and because the broken version looks
// perfectly reasonable: NoteGrid used to decide "somebody trashed this note"
// from `event.keysChanged.has('trashed') && metadata.get('trashed') === true`.
//
// That is true in two completely different situations:
//
//   • a collaborator just trashed a note you were looking at   — news
//   • a note that was ALREADY trashed just finished loading     — not news
//
// So on any cold start, every note already in the trash announced itself as a
// brand-new deletion. Reported from testing: seven notes trashed and revoked in
// one session came back after a cache clear as seven dimmed tombstones with a
// sync chip of seven, demanding a second flush for removals already applied.
//
// The discriminator is `event.changes.keys`, pinned down here so the check
// cannot be "simplified" back to reading the current value:
//
//   the key APPEARED -> action 'add',    oldValue undefined   (a load)
//   the key CHANGED  -> action 'update', oldValue false       (a trashing)
//
// It is also the right SHAPE of fix for this codebase: the answer travels in
// the data, so it behaves identically on a fast connection and a slow one. No
// timing gate can tell these two apart at all, at any threshold.
//
// ── A note on how these are modelled ────────────────────────────────────────
// Every scenario replays checkpoints from ONE owner's document, because that is
// what actually happens: the owner writes, everyone else receives. An earlier
// version of this file built the "already loaded" state in a second Y.Doc and
// then merged the owner's state onto it, which makes `trashed` a CONCURRENT
// write from two clients — resolved by client id, so the test's own outcome
// depended on which random id sorted higher. Flaky for a reason that has
// nothing to do with the behaviour under test.
//
// Run individually:  node --test tests/yjs-metadata-change-semantics.test.js
// Run with suite:    npm test
// ─────────────────────────────────────────────────────────────────────────────

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');

/**
 * One note's history as its owner wrote it, captured at three points.
 *
 * Applying these in order is exactly what a recipient's client does, whether the
 * updates arrive from IndexedDB, from the server on a cold start, or live over
 * the socket.
 */
function ownerTimeline() {
	const owner = new Y.Doc();
	const meta = owner.getMap('metadata');
	owner.transact(() => {
		meta.set('type', 'text');
		meta.set('trashed', false);
	});
	const untrashed = Y.encodeStateAsUpdate(owner);
	owner.transact(() => { meta.set('trashed', true); });
	const trashed = Y.encodeStateAsUpdate(owner);
	owner.transact(() => { meta.set('trashed', false); });
	const restored = Y.encodeStateAsUpdate(owner);
	return { untrashed, trashed, restored };
}

/** Collect what a metadata observer saw about `trashed`. */
function watchTrashed(doc) {
	const seen = [];
	doc.getMap('metadata').observe((event) => {
		const change = event.changes.keys.get('trashed');
		if (!change) return;
		seen.push({
			action: change.action,
			oldValue: change.oldValue,
			newValue: event.target.get('trashed'),
			inKeysChanged: event.keysChanged.has('trashed'),
		});
	});
	return seen;
}

/** The check NoteGrid actually uses. Keep in step with the observer there. */
const isRemoteTrashing = (seen) => seen.some((entry) => (
	entry.action === 'update' && entry.oldValue !== true && entry.newValue === true
));

/** The check it used to use, kept so the difference stays visible. */
const brokenCheck = (seen) => seen.some((entry) => entry.inKeysChanged && entry.newValue === true);

describe('a key APPEARING is not a key CHANGING', () => {
	it('reports action "add" when an already-trashed note loads', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].action, 'add');
		assert.equal(seen[0].oldValue, undefined);
		assert.equal(seen[0].newValue, true);
	});

	it('reports action "update" with oldValue false when somebody trashes it', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.untrashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].action, 'update');
		assert.equal(seen[0].oldValue, false);
		assert.equal(seen[0].newValue, true);
	});

	it('keysChanged and the current value CANNOT tell them apart', () => {
		// The whole reason the bug was invisible on inspection.
		const timeline = ownerTimeline();

		const cold = new Y.Doc();
		const coldSeen = watchTrashed(cold);
		Y.applyUpdate(cold, timeline.trashed);

		const live = new Y.Doc();
		Y.applyUpdate(live, timeline.untrashed);
		const liveSeen = watchTrashed(live);
		Y.applyUpdate(live, timeline.trashed);

		assert.equal(brokenCheck(coldSeen), true, 'the old check fired on a mere load');
		assert.equal(brokenCheck(liveSeen), true, 'and on a real trashing - indistinguishable');
	});
});

describe('the rule NoteGrid uses', () => {
	it('ignores an already-trashed note finishing its load', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(isRemoteTrashing(seen), false);
	});

	it('fires when a collaborator trashes a note this client already holds', () => {
		// Covers both the live case and the warm boot: a doc seeded from IndexedDB and a doc
		// mid-session are the same thing to the observer, because both already hold the earlier
		// state when the trashing arrives.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.untrashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(isRemoteTrashing(seen), true);
	});

	it('does not fire when a trashed note is restored', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.trashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.restored);
		assert.equal(isRemoteTrashing(seen), false);
	});

	it('does not fire again when the same trashed state is re-applied', () => {
		// Reconnects and resyncs re-send state the client already has. A removal must not be
		// announced a second time for it.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.untrashed);
		Y.applyUpdate(doc, timeline.trashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(isRemoteTrashing(seen), false, 'nothing changed, so there is nothing to say');
	});

	it('fires exactly once across a full cold load then a later trashing', () => {
		// The sequence that matters most: cold start of a live note, then the owner trashes it.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.untrashed); // load: 'add', value false - not a trashing
		Y.applyUpdate(doc, timeline.trashed); // the real thing
		const firings = seen.filter((entry) => (
			entry.action === 'update' && entry.oldValue !== true && entry.newValue === true
		));
		assert.equal(firings.length, 1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Coming back OUT of the trash.
//
// A note carrying two collaborators' edit chips was trashed - which ended the
// collaboration - and restored, and the chips came back naming two people who
// no longer had access. So a restore has to clear whatever was marked on the
// note, and it is detected from the note's own data because `restoreNote` has
// five call sites and `setNoteTrashed` is also called directly elsewhere.
//
// It is the SAME trap as the trashing rule, and it would have bitten
// identically: on a cold load `trashed` arrives as action 'add' with value
// false, which by value alone is indistinguishable from a restore. Treating
// that as a restore would clear every legitimate edit chip on startup - the
// mirror image of the bug that invented tombstones out of cold loads.
// ─────────────────────────────────────────────────────────────────────────────

/** The rule NoteGrid uses to spot a note leaving the trash. */
const isRemoteRestore = (seen) => seen.some((entry) => (
	entry.action === 'update' && entry.oldValue === true && entry.newValue !== true
));

describe('spotting a restore', () => {
	it('fires when a trashed note is restored', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.trashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.restored);
		assert.equal(isRemoteRestore(seen), true);
	});

	it('does NOT fire on a cold load of an untrashed note', () => {
		// The trap. `trashed: false` arriving as the key appears is a load, not a restore - and
		// clearing on it would wipe every edit chip the moment the app started.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.untrashed);
		assert.equal(isRemoteRestore(seen), false);
	});

	it('does NOT fire on a cold load of an already-trashed note', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(isRemoteRestore(seen), false);
	});

	it('does NOT fire when a note is trashed', () => {
		// The two rules must be mutually exclusive, or trashing would both mark the card and
		// immediately clear it.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.untrashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		assert.equal(isRemoteRestore(seen), false);
		assert.equal(isRemoteTrashing(seen), true, 'that same event IS a trashing');
	});

	it('does not fire again when the restored state is re-applied', () => {
		// Reconnects re-send state the client already has.
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.trashed);
		Y.applyUpdate(doc, timeline.restored);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.restored);
		assert.equal(isRemoteRestore(seen), false);
	});

	it('fires once per trash-and-restore cycle', () => {
		const timeline = ownerTimeline();
		const doc = new Y.Doc();
		Y.applyUpdate(doc, timeline.untrashed);
		const seen = watchTrashed(doc);
		Y.applyUpdate(doc, timeline.trashed);
		Y.applyUpdate(doc, timeline.restored);
		const restores = seen.filter((e) => e.action === 'update' && e.oldValue === true && e.newValue !== true);
		const trashings = seen.filter((e) => e.action === 'update' && e.oldValue !== true && e.newValue === true);
		assert.equal(trashings.length, 1);
		assert.equal(restores.length, 1);
	});
});
