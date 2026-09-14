const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyUploadPath, createUploadAccessResolver } = require('../server/uploadAccess');

const IMAGE_ID = '11111111-2222-3333-4444-555555555555';
const VERSION_ID = '99999999-8888-7777-6666-555555555555';
const LEGACY_DOCUMENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DOC_ID = 'workspace-a:note-1';

function makePrisma({ image = null, versions = [] } = {}) {
	return {
		noteImage: { findUnique: async ({ where }) => (image && where.id === image.id ? image : null) },
		noteDocumentVersion: {
			findUnique: async ({ where }) => versions.find((version) => version.id === where.id) || null,
			findMany: async ({ where }) => versions.filter((version) => version.noteDocumentId === where.noteDocumentId),
		},
	};
}

const imageRow = {
	id: IMAGE_ID,
	docId: DOC_ID,
	originalPath: `users/u1/notes/${IMAGE_ID}/original.webp`,
	thumbnailPath: `users\\u1\\notes\\${IMAGE_ID}\\thumb.webp`,
	deletedAt: null,
};

const versionRow = {
	id: VERSION_ID,
	noteDocumentId: 'doc-row-1',
	originalPath: `users/u1/documents/${VERSION_ID}/Blueprint.pdf`,
	previewPath: `users/u1/documents/${VERSION_ID}/preview.webp`,
	thumbnailPath: `users/u1/documents/${VERSION_ID}/thumb.webp`,
	fileName: 'Blueprint.pdf',
	deletedAt: null,
	noteDocument: { docId: DOC_ID, deletedAt: null },
};

const legacyVersionRow = {
	id: 'legacy-version-1',
	noteDocumentId: LEGACY_DOCUMENT_ID,
	originalPath: `users/u1/notes/${LEGACY_DOCUMENT_ID}/documents/Old.docx`,
	previewPath: `users/u1/notes/${LEGACY_DOCUMENT_ID}/documents/preview.webp`,
	thumbnailPath: `users/u1/notes/${LEGACY_DOCUMENT_ID}/documents/thumb.webp`,
	fileName: 'Old.docx',
	deletedAt: null,
	noteDocument: { docId: DOC_ID, deletedAt: null },
};

const allowEveryone = async () => ({});

test('classifyUploadPath recognises avatars, note media, document versions, and rejects everything else', () => {
	assert.deepEqual(classifyUploadPath('user-123.webp'), { kind: 'avatar' });
	assert.deepEqual(classifyUploadPath(`users/u1/notes/${IMAGE_ID}/thumb.webp`), { kind: 'note-media', mediaId: IMAGE_ID });
	assert.deepEqual(classifyUploadPath(`users/u1/documents/${VERSION_ID}/Blueprint.pdf`), { kind: 'document-version', versionId: VERSION_ID });
	assert.equal(classifyUploadPath('user-123.png'), null);
	assert.equal(classifyUploadPath('random/file.webp'), null);
	assert.equal(classifyUploadPath('users/u1/notes/not-a-uuid/thumb.webp'), null);
	assert.equal(classifyUploadPath(`users/u1/other/${IMAGE_ID}/thumb.webp`), null);
	assert.equal(classifyUploadPath(`users/u1/notes/${IMAGE_ID}/../../secret.webp`), null);
	assert.equal(classifyUploadPath(''), null);
});

test('logged-out requests are refused for every kind of file', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ image: imageRow, versions: [versionRow] }), resolveAccess: allowEveryone });
	assert.equal((await resolver.resolve(null, 'user-123.webp')).allowed, false);
	assert.equal((await resolver.resolve(null, imageRow.originalPath)).allowed, false);
	assert.equal((await resolver.resolve({}, versionRow.originalPath)).allowed, false);
});

test('any logged-in user can read avatars', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => null, resolveAccess: async () => null });
	assert.deepEqual(await resolver.resolve({ userId: 'u2' }, 'user-123.webp'), { allowed: true, kind: 'avatar' });
});

test('note images require access to the note they belong to', async () => {
	const prisma = makePrisma({ image: imageRow });
	const allowUsers = new Set(['owner']);
	const resolver = createUploadAccessResolver({
		getPrisma: () => prisma,
		resolveAccess: async (_prisma, session, docId) => (allowUsers.has(session.userId) && docId === DOC_ID ? { docId } : null),
	});
	assert.equal((await resolver.resolve({ userId: 'owner' }, imageRow.originalPath)).allowed, true);
	// Stored with Windows separators, requested with forward slashes.
	assert.equal((await resolver.resolve({ userId: 'owner' }, `users/u1/notes/${IMAGE_ID}/thumb.webp`)).allowed, true);
	assert.equal((await resolver.resolve({ userId: 'stranger' }, imageRow.originalPath)).allowed, false);
});

test('a path that does not match the row exactly is refused even with note access', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ image: imageRow, versions: [versionRow] }), resolveAccess: allowEveryone });
	assert.equal((await resolver.resolve({ userId: 'owner' }, `users/u1/notes/${IMAGE_ID}/other.webp`)).allowed, false);
	assert.equal((await resolver.resolve({ userId: 'owner' }, `users/someone-else/notes/${IMAGE_ID}/original.webp`)).allowed, false);
	assert.equal((await resolver.resolve({ userId: 'owner' }, `users/u1/documents/${VERSION_ID}/Other.pdf`)).allowed, false);
});

test('deleted images, versions, and documents are refused', async () => {
	const deletedImage = createUploadAccessResolver({
		getPrisma: () => makePrisma({ image: { ...imageRow, deletedAt: new Date() } }),
		resolveAccess: allowEveryone,
	});
	assert.equal((await deletedImage.resolve({ userId: 'owner' }, imageRow.originalPath)).allowed, false);

	const deletedVersion = createUploadAccessResolver({
		getPrisma: () => makePrisma({ versions: [{ ...versionRow, deletedAt: new Date() }] }),
		resolveAccess: allowEveryone,
	});
	assert.equal((await deletedVersion.resolve({ userId: 'owner' }, versionRow.originalPath)).allowed, false);

	const deletedDocument = createUploadAccessResolver({
		getPrisma: () => makePrisma({ versions: [{ ...versionRow, noteDocument: { docId: DOC_ID, deletedAt: new Date() } }] }),
		resolveAccess: allowEveryone,
	});
	assert.equal((await deletedDocument.resolve({ userId: 'owner' }, versionRow.originalPath)).allowed, false);
});

test('document versions report whether the request is the original file or a preview', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ versions: [versionRow] }), resolveAccess: allowEveryone });
	assert.deepEqual(await resolver.resolve({ userId: 'owner' }, versionRow.originalPath), {
		allowed: true,
		kind: 'document-original',
		fileName: 'Blueprint.pdf',
	});
	assert.equal((await resolver.resolve({ userId: 'owner' }, versionRow.thumbnailPath)).kind, 'document-preview');
});

test('the converted view PDF of an office file is readable with note access', async () => {
	const officeVersion = {
		...versionRow,
		originalPath: `users/u1/documents/${VERSION_ID}/Budget.xlsx`,
		viewPdfPath: `users/u1/documents/${VERSION_ID}/view.pdf`,
		fileName: 'Budget.xlsx',
	};
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ versions: [officeVersion] }), resolveAccess: allowEveryone });
	assert.equal((await resolver.resolve({ userId: 'owner' }, officeVersion.viewPdfPath)).kind, 'document-view');
	// A version with no converted copy never matches a guessed view.pdf path.
	const pdfOnly = createUploadAccessResolver({ getPrisma: () => makePrisma({ versions: [{ ...versionRow, viewPdfPath: null }] }), resolveAccess: allowEveryone });
	assert.equal((await pdfOnly.resolve({ userId: 'owner' }, `users/u1/documents/${VERSION_ID}/view.pdf`)).allowed, false);
});

test('document versions still check note access', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ versions: [versionRow] }), resolveAccess: async () => null });
	assert.equal((await resolver.resolve({ userId: 'stranger' }, versionRow.originalPath)).allowed, false);
});

test('documents uploaded before versions existed are still found by their old folder', async () => {
	const resolver = createUploadAccessResolver({ getPrisma: () => makePrisma({ versions: [legacyVersionRow] }), resolveAccess: allowEveryone });
	assert.deepEqual(await resolver.resolve({ userId: 'owner' }, legacyVersionRow.originalPath), {
		allowed: true,
		kind: 'document-original',
		fileName: 'Old.docx',
	});
	assert.equal((await resolver.resolve({ userId: 'owner' }, legacyVersionRow.previewPath)).kind, 'document-preview');
});

test('access grants are cached briefly, then re-checked', async () => {
	let clock = 1_000;
	let calls = 0;
	let allowed = true;
	const resolver = createUploadAccessResolver({
		getPrisma: () => makePrisma({ image: imageRow }),
		resolveAccess: async () => { calls += 1; return allowed ? {} : null; },
		now: () => clock,
	});
	assert.equal((await resolver.resolve({ userId: 'owner' }, imageRow.originalPath)).allowed, true);
	assert.equal((await resolver.resolve({ userId: 'owner' }, imageRow.originalPath)).allowed, true);
	assert.equal(calls, 1);
	allowed = false;
	clock += 31_000;
	assert.equal((await resolver.resolve({ userId: 'owner' }, imageRow.originalPath)).allowed, false);
	assert.equal(calls, 2);
});

test('refusals are not cached, so a newly granted share works right away', async () => {
	let allowed = false;
	const resolver = createUploadAccessResolver({
		getPrisma: () => makePrisma({ image: imageRow }),
		resolveAccess: async () => (allowed ? {} : null),
	});
	assert.equal((await resolver.resolve({ userId: 'newcomer' }, imageRow.originalPath)).allowed, false);
	allowed = true;
	assert.equal((await resolver.resolve({ userId: 'newcomer' }, imageRow.originalPath)).allowed, true);
});
