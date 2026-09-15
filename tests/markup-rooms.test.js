const test = require('node:test');
const assert = require('node:assert/strict');
const {
	isMarkupRoomName,
	parseMarkupRoomName,
	markupRoomName,
	resolveMarkupRoomAccess,
	loadMarkupState,
	saveMarkupState,
} = require('../server/markupRooms');

const VERSION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const DOC_ID = 'workspace-a:note-1';
const SESSION = { userId: 'user-1', workspaceId: 'workspace-a' };

function makePrisma(version) {
	const calls = [];
	return {
		calls,
		noteDocumentVersion: {
			findUnique: async ({ where }) => {
				calls.push(where.id);
				return version && version.id === where.id ? version : null;
			},
		},
	};
}

const liveVersion = { id: VERSION_ID, deletedAt: null, noteDocument: { docId: DOC_ID, deletedAt: null } };

test('markup room names: only "markup:<uuid>" is a markup room, and ids are normalised', () => {
	assert.equal(isMarkupRoomName(`markup:${VERSION_ID}`), true);
	assert.equal(isMarkupRoomName(`workspace-a:${VERSION_ID}`), false);
	assert.equal(isMarkupRoomName(null), false);
	assert.equal(parseMarkupRoomName(`workspace-a:note-1`), undefined);
	assert.equal(parseMarkupRoomName('__notes_registry__'), undefined);
	assert.equal(parseMarkupRoomName('markup:'), null);
	assert.equal(parseMarkupRoomName('markup:not-a-uuid'), null);
	assert.equal(parseMarkupRoomName(`markup:${VERSION_ID}/../x`), null);
	assert.equal(parseMarkupRoomName(`markup:${VERSION_ID.toUpperCase()}`), VERSION_ID);
	assert.equal(markupRoomName(VERSION_ID.toUpperCase()), `markup:${VERSION_ID}`);
});

test('logged-out users and malformed ids are refused without touching the database', async () => {
	const prisma = makePrisma(liveVersion);
	const allow = async () => ({ accessRole: 'EDITOR' });
	assert.equal(await resolveMarkupRoomAccess(prisma, null, VERSION_ID, { resolveAccess: allow }), null);
	assert.equal(await resolveMarkupRoomAccess(prisma, {}, VERSION_ID, { resolveAccess: allow }), null);
	assert.equal(await resolveMarkupRoomAccess(prisma, SESSION, 'nope', { resolveAccess: allow }), null);
	assert.deepEqual(prisma.calls, []);
});

test('missing or deleted versions and documents are refused, even for someone with note access', async () => {
	const allow = async () => ({ accessRole: 'EDITOR' });
	assert.equal(await resolveMarkupRoomAccess(makePrisma(null), SESSION, VERSION_ID, { resolveAccess: allow }), null);
	assert.equal(await resolveMarkupRoomAccess(makePrisma({ ...liveVersion, deletedAt: new Date() }), SESSION, VERSION_ID, { resolveAccess: allow }), null);
	assert.equal(
		await resolveMarkupRoomAccess(makePrisma({ ...liveVersion, noteDocument: { docId: DOC_ID, deletedAt: new Date() } }), SESSION, VERSION_ID, { resolveAccess: allow }),
		null,
	);
	assert.equal(await resolveMarkupRoomAccess(makePrisma({ ...liveVersion, noteDocument: null }), SESSION, VERSION_ID, { resolveAccess: allow }), null);
});

test('access follows the note the document is attached to', async () => {
	const seen = [];
	const deny = async (_prisma, session, docId, opts) => {
		seen.push({ userId: session.userId, docId, context: opts.context });
		return null;
	};
	assert.equal(await resolveMarkupRoomAccess(makePrisma(liveVersion), SESSION, VERSION_ID, { resolveAccess: deny }), null);
	assert.deepEqual(seen, [{ userId: 'user-1', docId: DOC_ID, context: 'markup-room' }]);
});

test('editors can draw; viewers and view-only collaborators are read-only', async () => {
	const editor = await resolveMarkupRoomAccess(makePrisma(liveVersion), SESSION, VERSION_ID, { resolveAccess: async () => ({ accessRole: 'EDITOR' }) });
	assert.deepEqual(editor, { versionId: VERSION_ID, docId: DOC_ID, readOnly: false });
	const viewer = await resolveMarkupRoomAccess(makePrisma(liveVersion), SESSION, VERSION_ID, { resolveAccess: async () => ({ accessRole: 'VIEWER' }) });
	assert.equal(viewer.readOnly, true);
	// Anything that isn't explicitly EDITOR stays read-only.
	const odd = await resolveMarkupRoomAccess(makePrisma(liveVersion), SESSION, VERSION_ID, { resolveAccess: async () => ({}) });
	assert.equal(odd.readOnly, true);
});

test('uppercase version ids are looked up in their canonical lowercase form', async () => {
	const prisma = makePrisma(liveVersion);
	const access = await resolveMarkupRoomAccess(prisma, SESSION, VERSION_ID.toUpperCase(), { resolveAccess: async () => ({ accessRole: 'EDITOR' }) });
	assert.equal(access.versionId, VERSION_ID);
	assert.deepEqual(prisma.calls, [VERSION_ID]);
});

test('markup state is saved with an upsert on the version id and read back as buffers', async () => {
	const executed = [];
	const stored = { state: null, stateVector: null };
	const prisma = {
		$executeRaw: async (strings, ...values) => {
			executed.push(strings.join('?'));
			[, stored.state, stored.stateVector] = values;
			return 1;
		},
		$queryRaw: async (strings, ...values) => {
			assert.match(strings.join('?'), /FROM "note_document_markup"/);
			assert.equal(values[0], VERSION_ID);
			return stored.state ? [{ state: stored.state, state_vector: stored.stateVector }] : [];
		},
	};
	assert.equal(await loadMarkupState(prisma, VERSION_ID), null);
	await saveMarkupState(prisma, VERSION_ID, new Uint8Array([1, 2, 3]), new Uint8Array([9]));
	assert.match(executed[0], /INSERT INTO "note_document_markup"/);
	assert.match(executed[0], /ON CONFLICT \("version_id"\) DO UPDATE/);
	const loaded = await loadMarkupState(prisma, VERSION_ID);
	assert.deepEqual([...loaded.state], [1, 2, 3]);
	assert.deepEqual([...loaded.stateVector], [9]);
});
