const test = require('node:test');
const assert = require('node:assert/strict');
const { listManifestDocuments } = require('../server/noteDocumentManifest');

const include = { versions: { take: 1 } };
const fixedNow = () => new Date('2026-09-14T12:00:00.000Z');

function fakePrisma(rows = []) {
	const calls = [];
	return {
		calls,
		noteDocument: {
			findMany: async (args) => {
				calls.push(args);
				return rows;
			},
		},
	};
}

const mapDocument = (row) => (row.versions.length === 0
	? null
	: { id: row.id, docId: row.docId, originalUrl: `/uploads/${row.id}.pdf`, ocrText: 'a very long extracted text' });

test('no workspaces and no shares: no query, empty manifest', async () => {
	const prisma = fakePrisma();
	const result = await listManifestDocuments({ prisma, workspaceIds: [], sharedDocIds: [], include, mapDocument, now: fixedNow });
	assert.deepEqual(result, { generatedAt: '2026-09-14T12:00:00.000Z', documents: [], count: 0 });
	assert.equal(prisma.calls.length, 0);
});

test('scopes to member workspaces and shared notes, skipping deleted documents', async () => {
	const prisma = fakePrisma();
	await listManifestDocuments({
		prisma,
		workspaceIds: ['ws-1', 'ws-2'],
		sharedDocIds: ['ws-9:note-4'],
		include,
		mapDocument,
		now: fixedNow,
	});
	assert.equal(prisma.calls.length, 1);
	assert.deepEqual(prisma.calls[0].where, {
		deletedAt: null,
		document: { is: { OR: [{ workspaceId: { in: ['ws-1', 'ws-2'] } }, { docId: { in: ['ws-9:note-4'] } }] } },
	});
	assert.equal(prisma.calls[0].include, include);
});

test('only shared notes: the scope is just those notes', async () => {
	const prisma = fakePrisma();
	await listManifestDocuments({ prisma, workspaceIds: [], sharedDocIds: ['ws-9:note-4'], include, mapDocument, now: fixedNow });
	assert.deepEqual(prisma.calls[0].where.document, { is: { OR: [{ docId: { in: ['ws-9:note-4'] } }] } });
});

test('drops extracted text and documents with no live version', async () => {
	const prisma = fakePrisma([
		{ id: 'doc-1', docId: 'ws-1:note-1', versions: [{ id: 'v1' }] },
		{ id: 'doc-2', docId: 'ws-1:note-2', versions: [] },
	]);
	const result = await listManifestDocuments({ prisma, workspaceIds: ['ws-1'], sharedDocIds: [], include, mapDocument, now: fixedNow });
	assert.equal(result.count, 1);
	assert.deepEqual(result.documents, [{ id: 'doc-1', docId: 'ws-1:note-1', originalUrl: '/uploads/doc-1.pdf' }]);
	assert.equal('ocrText' in result.documents[0], false);
});

test('generatedAt is stamped before the query runs', async () => {
	let clock = Date.parse('2026-09-14T12:00:00.000Z');
	const prisma = {
		noteDocument: {
			findMany: async () => {
				clock += 5000;
				return [];
			},
		},
	};
	const result = await listManifestDocuments({
		prisma,
		workspaceIds: ['ws-1'],
		sharedDocIds: [],
		include,
		mapDocument,
		now: () => new Date(clock),
	});
	assert.equal(result.generatedAt, '2026-09-14T12:00:00.000Z');
});
