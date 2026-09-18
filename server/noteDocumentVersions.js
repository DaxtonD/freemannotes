'use strict';

// Version housekeeping for documents (D6/D7): which old versions age out, and which ones a person
// is allowed to delete by hand. Pure functions, so the rules are testable without a database.

// Revisions pile up fast on a job site; keep the recent ones and let the rest go.
const MAX_AUTOMATIC_VERSIONS = 10;

function liveVersionsNewestFirst(versions) {
	return (Array.isArray(versions) ? versions : [])
		.filter((version) => version && !version.deletedAt)
		.sort((left, right) => Number(right.versionNumber) - Number(left.versionNumber));
}

/**
 * Old versions to drop after a new one lands: everything past the newest `keep`, except any version
 * someone has marked up. Deleting those would quietly destroy work nobody asked us to throw away,
 * so they stay until a person deletes them on purpose.
 */
function planVersionRetention({ versions, markedUpVersionIds = [], keep = MAX_AUTOMATIC_VERSIONS }) {
	const protectedIds = new Set(Array.from(markedUpVersionIds, (id) => String(id)));
	return liveVersionsNewestFirst(versions)
		.slice(Math.max(0, keep))
		.filter((version) => !protectedIds.has(String(version.id)))
		.map((version) => version.id);
}

/**
 * Whether one version can be deleted by hand. The newest one can't: that's what the document *is*,
 * and removing it is the "remove this document from the note" button instead.
 */
function describeVersionDeletion({ versions, versionId }) {
	const live = liveVersionsNewestFirst(versions);
	const target = live.find((version) => String(version.id) === String(versionId));
	if (!target) return { ok: false, status: 404, error: 'Version not found' };
	if (live.length <= 1) return { ok: false, status: 400, error: 'A document must keep at least one version' };
	if (String(live[0].id) === String(target.id)) return { ok: false, status: 400, error: 'The latest version cannot be deleted' };
	return { ok: true, version: target };
}

/**
 * Whether an upload is the same file as one already stored: same name, same exact byte count.
 * Not a content hash — this is about someone picking the same file twice, not about catching a
 * renamed copy, and hashing every upload to find out would cost more than the problem is worth.
 */
function isSameStoredFile(version, { fileName, byteSize }) {
	if (!version) return false;
	return String(version.fileName) === String(fileName) && Number(version.byteSize) === Number(byteSize);
}

module.exports = {
	MAX_AUTOMATIC_VERSIONS,
	isSameStoredFile,
	describeVersionDeletion,
	liveVersionsNewestFirst,
	planVersionRetention,
};
