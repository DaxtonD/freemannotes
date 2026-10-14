/**
 * The maintenance view of a workspace: what the grid thinks exists versus what the database holds.
 *
 * A row in the `document` table that no registry claims is invisible in the grid and the trash
 * (both render from the registry's `noteOrder`) while global search still finds it, because
 * search queries the table directly. That is what a user reported as "I can't find this note,
 * but search can, and I can still edit it".
 *
 * The leak that produced them is fixed, so this exists to clear the backlog rather than to keep
 * up with an ongoing problem. It is deliberately a manual, preview-then-confirm tool and not an
 * automatic sweep: the rows are unreachable, not urgent, and nothing behind this has a trash to
 * fall back on.
 */

import { fetchJsonWithTimeout } from './network';

const AUDIT_TIMEOUT_MS = 30_000;
const PURGE_TIMEOUT_MS = 60_000;

export type OrphanDocument = {
	noteId: string;
	docId: string;
	type: string;
	title: string;
	preview: string;
	contentChars: number;
	checklistItemCount: number;
	checklistChars: number;
	trashed: boolean;
	/** False means no title, no text and no checklist text — a draft that was never written to. */
	hasContent: boolean;
	createdAt: string;
	updatedAt: string;
	bytes: number;
};

export type OrphanAudit = {
	workspaceId: string;
	/** Notes the registry claims, i.e. roughly what the grid can show. */
	registryNoteCount: number | null;
	/** Note rows in the database for this workspace, excluding registries and markup rooms. */
	documentNoteRows: number;
	/** Correctly absent from `noteOrder` — they hang off a parent note, so never orphans. */
	attachedDrawings: number;
	/** Held back because they are too new to be sure they are not a draft in progress. */
	skippedTooRecent: number;
	orphans: OrphanDocument[];
};

export async function auditOrphanDocuments(workspaceId: string): Promise<OrphanAudit> {
	return fetchJsonWithTimeout<OrphanAudit>(
		`/api/maintenance/orphan-documents?workspaceId=${encodeURIComponent(workspaceId)}`,
		{ credentials: 'include', timeoutMs: AUDIT_TIMEOUT_MS, requestName: 'orphan-audit' }
	);
}

/**
 * Delete specific orphaned rows.
 *
 * Sends the explicit ids the user was shown, not a "delete everything stale" flag — so consent
 * applies to a list someone actually read, and anything that became stale between the preview
 * and the confirmation is not swept up with it. The server re-checks every id against a fresh
 * audit and refuses any that is live, so a stale list cannot delete a real note.
 */
export async function purgeOrphanDocuments(
	workspaceId: string,
	noteIds: readonly string[]
): Promise<{ deleted: number; refused: string[] }> {
	return fetchJsonWithTimeout<{ deleted: number; refused: string[] }>(
		'/api/maintenance/orphan-documents',
		{
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ workspaceId, noteIds }),
			timeoutMs: PURGE_TIMEOUT_MS,
			requestName: 'orphan-purge',
		}
	);
}
