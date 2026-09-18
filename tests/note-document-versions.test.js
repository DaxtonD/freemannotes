const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_AUTOMATIC_VERSIONS, describeVersionDeletion, isSameStoredFile, planVersionRetention } = require('../server/noteDocumentVersions');

test('the same file is recognised by name and exact size', () => {
	const stored = { fileName: 'Plan.pdf', byteSize: 2048 };
	assert.equal(isSameStoredFile(stored, { fileName: 'Plan.pdf', byteSize: 2048 }), true);
	assert.equal(isSameStoredFile(stored, { fileName: 'Plan.pdf', byteSize: 2049 }), false, 'an edited file of the same name is a real revision');
	assert.equal(isSameStoredFile(stored, { fileName: 'Plan rev B.pdf', byteSize: 2048 }), false);
	assert.equal(isSameStoredFile(null, { fileName: 'Plan.pdf', byteSize: 2048 }), false);
});

const build = (count) => Array.from({ length: count }, (_, index) => ({ id: `v${index + 1}`, versionNumber: index + 1, deletedAt: null }));

test('keeps the newest ten versions and drops the rest, oldest included', () => {
	const pruned = planVersionRetention({ versions: build(13) });
	assert.equal(MAX_AUTOMATIC_VERSIONS, 10);
	assert.deepEqual(pruned.sort(), ['v1', 'v2', 'v3'].sort());
});

test('nothing is dropped until there are more than ten', () => {
	assert.deepEqual(planVersionRetention({ versions: build(10) }), []);
});

test('a version with markup is never dropped automatically', () => {
	const pruned = planVersionRetention({ versions: build(13), markedUpVersionIds: ['v2'] });
	assert.deepEqual(pruned.sort(), ['v1', 'v3'].sort());
});

test('already deleted versions do not count towards the ten kept', () => {
	const versions = build(12).map((version) => (version.versionNumber === 12 ? { ...version, deletedAt: new Date() } : version));
	// 11 live ones, so only the oldest goes.
	assert.deepEqual(planVersionRetention({ versions }), ['v1']);
});

test('the newest version cannot be deleted by hand', () => {
	const result = describeVersionDeletion({ versions: build(3), versionId: 'v3' });
	assert.equal(result.ok, false);
	assert.equal(result.status, 400);
});

test('an older version can be deleted by hand', () => {
	const result = describeVersionDeletion({ versions: build(3), versionId: 'v1' });
	assert.equal(result.ok, true);
	assert.equal(result.version.versionNumber, 1);
});

test('the only version cannot be deleted (that is removing the document)', () => {
	const result = describeVersionDeletion({ versions: build(1), versionId: 'v1' });
	assert.equal(result.ok, false);
	assert.equal(result.status, 400);
});

test('an unknown or already deleted version is a 404', () => {
	assert.equal(describeVersionDeletion({ versions: build(3), versionId: 'nope' }).status, 404);
	const versions = build(3).map((version) => (version.versionNumber === 1 ? { ...version, deletedAt: new Date() } : version));
	assert.equal(describeVersionDeletion({ versions, versionId: 'v1' }).status, 404);
});
