'use strict';

// Tells a device which documents it should keep a copy of: the latest version of every
// document the user can see, across every workspace they're in plus notes shared with them.
// "Can see" comes from buildAccessibleDocContext, the same thing search uses, so there's one
// idea of access rather than a second permission check quietly drifting out of step.

async function listManifestDocuments({ prisma, workspaceIds, sharedDocIds, include, mapDocument, now = () => new Date() }) {
	// Taken before the query. A document created after this moment may be missing from the
	// answer, and the client uses the timestamp so it never prunes a file for being too new.
	const generatedAt = now().toISOString();
	const scopes = [];
	if (Array.isArray(workspaceIds) && workspaceIds.length > 0) scopes.push({ workspaceId: { in: workspaceIds } });
	if (Array.isArray(sharedDocIds) && sharedDocIds.length > 0) scopes.push({ docId: { in: sharedDocIds } });
	if (scopes.length === 0) return { generatedAt, documents: [], count: 0 };

	const rows = await prisma.noteDocument.findMany({
		where: {
			deletedAt: null,
			document: { is: { OR: scopes } },
		},
		orderBy: { createdAt: 'asc' },
		include,
	});

	const documents = [];
	for (const row of rows) {
		const mapped = mapDocument(row);
		if (!mapped) continue;
		// Extracted text can run to 100k characters per file, and a device pulling the whole
		// list doesn't need it. Opening a note's documents still brings it down.
		const entry = { ...mapped };
		delete entry.ocrText;
		documents.push(entry);
	}
	return { generatedAt, documents, count: documents.length };
}

module.exports = { listManifestDocuments };
