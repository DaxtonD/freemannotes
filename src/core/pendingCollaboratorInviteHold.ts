// Doc IDs for notes that are still "pending new" (created so typing can start
// instantly, but not yet explicitly saved — see App.tsx pendingNewNoteIdsRef).
// A collaborator invite queued against a held doc is skipped by
// flushPendingCollaboratorActions until the doc is released, so sharing a note
// never actually reaches a collaborator until the sharer commits to keeping it.
// Without this, canceling a brand-new note after adding a collaborator would
// leave that collaborator with a "note shared with you" notification pointing
// at a note that no longer exists.
const heldDocIds = new Set<string>();

export function holdCollaboratorInvitesForDoc(docId: string): void {
	if (!docId) return;
	heldDocIds.add(docId);
}

export function releaseCollaboratorInvitesForDoc(docId: string): void {
	heldDocIds.delete(docId);
}

export function isCollaboratorInvitesHeldForDoc(docId: string): boolean {
	return heldDocIds.has(docId);
}
