'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PDF markup rooms.
//
// Every document version has its own Yjs room for markup (drawings, stamps, symbols, comment pins
// and replies), named "markup:<versionId>". These rooms are deliberately NOT ordinary note rooms:
//
// - They belong to a document version, not to a workspace. Moving the note to another workspace
//   rewrites the note's docId but not the version id, so the markup comes along untouched.
// - They're saved in their own table (note_document_markup), which is deleted with its version,
//   instead of the `document` table that note listings, trash cleanup and @mention detection
//   all walk.
// - Access is decided by the note the document is attached to, through the same resolveDocAccess
//   that guards the document's files: anyone who can open the note can see the markup, EDITOR
//   access can draw, VIEWER access (workspace viewers and view-only collaborators) is read-only,
//   and a deleted version or document is refused outright.
//
// Reads and writes use plain SQL on the mapped table name rather than a Prisma model delegate, so
// they work without regenerating the Prisma client (on Windows that fails while a server holds the
// query engine open). The model is still declared in schema.prisma for migrations.
// ─────────────────────────────────────────────────────────────────────────────

const MARKUP_ROOM_PREFIX = 'markup:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMarkupRoomName(roomName) {
	return typeof roomName === 'string' && roomName.startsWith(MARKUP_ROOM_PREFIX);
}

/**
 * @returns {string | null | undefined} the version id for a valid markup room, null for something
 *   that claims to be a markup room but isn't valid, undefined for any other room.
 */
function parseMarkupRoomName(roomName) {
	if (!isMarkupRoomName(roomName)) return undefined;
	const versionId = roomName.slice(MARKUP_ROOM_PREFIX.length);
	return UUID_PATTERN.test(versionId) ? versionId.toLowerCase() : null;
}

function markupRoomName(versionId) {
	return `${MARKUP_ROOM_PREFIX}${String(versionId).toLowerCase()}`;
}

/**
 * Who may join a markup room, and whether they may change it.
 *
 * @returns {Promise<{ versionId: string, docId: string, readOnly: boolean } | null>} null = refuse.
 */
async function resolveMarkupRoomAccess(prisma, session, versionId, { resolveAccess = null } = {}) {
	if (!session || !session.userId || !prisma) return null;
	if (typeof versionId !== 'string' || !UUID_PATTERN.test(versionId)) return null;
	const version = await prisma.noteDocumentVersion.findUnique({
		where: { id: versionId.toLowerCase() },
		select: { id: true, deletedAt: true, noteDocument: { select: { docId: true, deletedAt: true } } },
	});
	if (!version || version.deletedAt || !version.noteDocument || version.noteDocument.deletedAt) return null;
	const resolver = resolveAccess || require('./noteShareRouter').resolveDocAccess;
	const access = await resolver(prisma, session, version.noteDocument.docId, { context: 'markup-room' });
	if (!access) return null;
	return {
		versionId: version.id,
		docId: version.noteDocument.docId,
		readOnly: access.accessRole !== 'EDITOR',
	};
}

/** @returns {Promise<{ state: Buffer, stateVector: Buffer | null } | null>} */
async function loadMarkupState(prisma, versionId) {
	const rows = await prisma.$queryRaw`
		SELECT "state", "state_vector"
		FROM "note_document_markup"
		WHERE "version_id" = ${versionId}::uuid
		LIMIT 1
	`;
	const row = Array.isArray(rows) ? rows[0] : null;
	if (!row || !row.state) return null;
	return {
		state: Buffer.from(row.state),
		stateVector: row.state_vector ? Buffer.from(row.state_vector) : null,
	};
}

async function saveMarkupState(prisma, versionId, state, stateVector) {
	await prisma.$executeRaw`
		INSERT INTO "note_document_markup" ("version_id", "state", "state_vector", "created_at", "updated_at")
		VALUES (${versionId}::uuid, ${Buffer.from(state)}, ${Buffer.from(stateVector)}, NOW(), NOW())
		ON CONFLICT ("version_id") DO UPDATE
		SET "state" = EXCLUDED."state", "state_vector" = EXCLUDED."state_vector", "updated_at" = NOW()
	`;
}

/**
 * Which of these versions have markup saved on the server. Used to decide what version housekeeping
 * may quietly delete, and to warn before a person deletes a version by hand.
 */
async function listVersionsWithMarkup(prisma, versionIds) {
	const ids = Array.from(new Set(Array.from(versionIds || [], (id) => String(id)).filter((id) => UUID_PATTERN.test(id))));
	if (ids.length === 0) return [];
	const rows = await prisma.$queryRaw`
		SELECT "version_id"
		FROM "note_document_markup"
		WHERE "version_id" = ANY(${ids}::uuid[])
	`;
	return rows.map((row) => String(row.version_id));
}

module.exports = {
	MARKUP_ROOM_PREFIX,
	listVersionsWithMarkup,
	isMarkupRoomName,
	parseMarkupRoomName,
	markupRoomName,
	resolveMarkupRoomAccess,
	loadMarkupState,
	saveMarkupState,
};
