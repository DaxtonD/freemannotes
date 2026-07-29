import type * as Y from 'yjs';
import type { DocumentManager } from './DocumentManager';
import type { NoteSearchGroup, NoteSearchMatchKind, NoteSearchResult } from './noteMediaApi';
import { buildCollectionPathMap, type CollectionRecord } from '../services/collectionService';
import type { LabelRecord } from '../services/labelService';
import { readArchiveState, readTrashState } from './noteModel';
import { getChecklistItemPlainText } from './richText';
import { readCachedNoteShareCollaborators, type SharedNotePlacement } from './noteShareApi';
import { readStoredNoteLinks } from './noteLinkStore';
import { readStoredRemoteNoteImages } from './noteMediaStore';
import { readStoredRemoteNoteDocuments } from './noteDocumentStore';

type SearchOfflineNotesArgs = {
	manager: DocumentManager;
	query: string;
	authUserId?: string | null;
	activeWorkspaceId?: string | null;
	activeWorkspaceName?: string | null;
	collections?: readonly CollectionRecord[];
	labels?: readonly LabelRecord[];
	sharedPlacements?: readonly SharedNotePlacement[];
};

function normalizeText(value: unknown): string {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildSearchSnippet(haystack: unknown, query: string): string {
	const normalizedHaystack = normalizeText(haystack);
	const normalizedQuery = normalizeText(query).toLowerCase();
	if (!normalizedHaystack) return '';
	if (!normalizedQuery) return normalizedHaystack.slice(0, 180);
	const lowerHaystack = normalizedHaystack.toLowerCase();
	const index = lowerHaystack.indexOf(normalizedQuery);
	if (index === -1) return normalizedHaystack.slice(0, 180);
	const start = Math.max(0, index - 48);
	const end = Math.min(normalizedHaystack.length, index + normalizedQuery.length + 96);
	const prefix = start > 0 ? '... ' : '';
	const suffix = end < normalizedHaystack.length ? ' ...' : '';
	return `${prefix}${normalizedHaystack.slice(start, end)}${suffix}`;
}

function includesQuery(value: unknown, normalizedQuery: string): boolean {
	return normalizeText(value).toLowerCase().includes(normalizedQuery);
}

function uniqueIds(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const output: string[] = [];
	for (const value of values) {
		const id = String(value || '').trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		output.push(id);
	}
	return output;
}

function getChecklistText(doc: Y.Doc): string {
	return doc.getArray<Y.Map<any>>('checklist')
		.toArray()
		.map((item) => normalizeText(getChecklistItemPlainText(item)))
		.filter(Boolean)
		.join(' ');
}

function metadataUpdatedAtIso(doc: Y.Doc): string {
	const metadata = doc.getMap<any>('metadata');
	const updatedAt = Number(metadata.get('updatedAt') ?? metadata.get('createdAt') ?? 0);
	return Number.isFinite(updatedAt) && updatedAt > 0 ? new Date(updatedAt).toISOString() : new Date(0).toISOString();
}

/**
 * Fast in-memory search: only searches docs already loaded into the Yjs runtime
 * (no IDB reads, no network). Returns instantly for the "warm" case where the
 * user has been using the app and most docs are resident.
 *
 * Matches title, note text, collections, and labels — not OCR / links /
 * documents / collaborators (those require IDB and are covered by the full
 * searchOfflineNotes pass that runs in the background).
 */
export async function searchLoadedNotes(args: SearchOfflineNotesArgs): Promise<readonly NoteSearchResult[]> {
	const normalizedQuery = normalizeText(args.query).toLowerCase();
	if (!normalizedQuery) return [];

	const noteOrder = await args.manager.getNoteOrder();
	const sharedPlacementByAlias = new Map((args.sharedPlacements ?? []).map((placement) => [placement.aliasId, placement] as const));
	const noteIds = uniqueIds([
		...noteOrder.toArray().map((value) => String(value || '').trim()),
		...(args.sharedPlacements ?? []).map((placement) => String(placement.aliasId || '').trim()),
	]);
	const workspaceId = String(args.activeWorkspaceId || '').trim() || null;
	const workspaceLabel = String(args.activeWorkspaceName || '').trim() || workspaceId || 'Workspace';
	const collectionPathById = buildCollectionPathMap(args.collections ?? []);
	const labelById = new Map((args.labels ?? []).map((label) => [label.id, label] as const));

	const results: NoteSearchResult[] = [];

	for (const noteId of noteIds) {
		if (!noteId || !args.manager.hasDoc(noteId)) continue;
		const placement = sharedPlacementByAlias.get(noteId) ?? null;
		const roomId = placement?.roomId || (workspaceId ? `${workspaceId}:${noteId}` : noteId);

		let doc: Y.Doc;
		try {
			doc = args.manager.getDoc(noteId);
		} catch {
			continue;
		}

		if (readTrashState(doc).trashed) continue;

		const title = normalizeText(doc.getText('title').toString());
		const metadata = doc.getMap<any>('metadata');
		const type = metadata.get('type') === 'checklist' ? 'checklist' : 'text';
		const collectionPath = typeof metadata.get('collectionId') === 'string'
			? collectionPathById.get(String(metadata.get('collectionId')).trim()) ?? ''
			: '';
		const labelMatches = Array.isArray(metadata.get('labelIds'))
			? metadata.get('labelIds')
				.map((labelId: unknown) => (typeof labelId === 'string' ? labelById.get(labelId.trim())?.name ?? '' : ''))
				.filter((labelName: string) => Boolean(labelName) && includesQuery(labelName, normalizedQuery))
			: [];
		const noteText = normalizeText(type === 'checklist' ? getChecklistText(doc) : doc.getText('content').toString());

		const matchKinds: NoteSearchMatchKind[] = [];
		if (includesQuery(`${title} ${noteText}`, normalizedQuery)) matchKinds.push('note');
		if (includesQuery(collectionPath, normalizedQuery)) matchKinds.push('collection');
		if (labelMatches.length > 0) matchKinds.push('label');
		if (matchKinds.length === 0) continue;

		const snippetSource = matchKinds.includes('note')
			? `${title} ${noteText}`
			: matchKinds.includes('collection')
				? collectionPath
				: labelMatches.join(' ');

		const group: NoteSearchGroup = placement
			? { kind: 'shared', label: workspaceLabel, workspaceId }
			: { kind: 'workspace', label: workspaceLabel, workspaceId };

		results.push({
			docId: roomId,
			noteId,
			title: title || 'Untitled',
			archived: readArchiveState(doc).archived,
			group,
			matchKinds,
			collaboratorMatches: [],
			collectionMatches: collectionPath && includesQuery(collectionPath, normalizedQuery) ? [collectionPath] : [],
			labelMatches: labelMatches.slice(0, 4),
			snippet: buildSearchSnippet(snippetSource, normalizedQuery),
			imageCount: 0,
			thumbnailUrl: null,
			updatedAt: metadataUpdatedAtIso(doc),
			openWorkspaceId: workspaceId,
			openNoteId: noteId,
			folderName: placement?.folderName ?? null,
		});
	}

	return results.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function searchOfflineNotes(args: SearchOfflineNotesArgs): Promise<readonly NoteSearchResult[]> {
	const normalizedQuery = normalizeText(args.query).toLowerCase();
	if (!normalizedQuery) return [];

	// Search the locally hydrated note set plus shared aliases so offline results
	// cover the same workspace surface the user can currently browse.
	const noteOrder = await args.manager.getNoteOrder();
	const sharedPlacementByAlias = new Map((args.sharedPlacements ?? []).map((placement) => [placement.aliasId, placement] as const));
	const noteIds = uniqueIds([
		...noteOrder.toArray().map((value) => String(value || '').trim()),
		...(args.sharedPlacements ?? []).map((placement) => String(placement.aliasId || '').trim()),
	]);
	const workspaceId = String(args.activeWorkspaceId || '').trim() || null;
	const workspaceLabel = String(args.activeWorkspaceName || '').trim() || workspaceId || 'Workspace';
	const collectionPathById = buildCollectionPathMap(args.collections ?? []);
	const labelById = new Map((args.labels ?? []).map((label) => [label.id, label] as const));

	const results = await Promise.all(noteIds.map(async (noteId) => {
		if (!noteId) return null;
		const placement = sharedPlacementByAlias.get(noteId) ?? null;
		const roomId = placement?.roomId || (workspaceId ? `${workspaceId}:${noteId}` : noteId);
		let doc: Y.Doc;
		try {
			doc = await args.manager.getDocWithSync(noteId);
		} catch {
			return null;
		}

		if (readTrashState(doc).trashed) return null;

		const title = normalizeText(doc.getText('title').toString());
		const metadata = doc.getMap<any>('metadata');
		const type = metadata.get('type') === 'checklist' ? 'checklist' : 'text';
		const collectionPath = typeof metadata.get('collectionId') === 'string'
			? collectionPathById.get(String(metadata.get('collectionId')).trim()) ?? ''
			: '';
		const labelMatches = Array.isArray(metadata.get('labelIds'))
			? metadata.get('labelIds')
				.map((labelId: unknown) => (typeof labelId === 'string' ? labelById.get(labelId.trim())?.name ?? '' : ''))
				.filter((labelName: string) => Boolean(labelName) && includesQuery(labelName, normalizedQuery))
			: [];
		const noteText = normalizeText(type === 'checklist' ? getChecklistText(doc) : doc.getText('content').toString());
		const [linkRows, imageRows, documentRows, collaboratorSnapshot] = await Promise.all([
			readStoredNoteLinks(roomId).catch(() => []),
			readStoredRemoteNoteImages(roomId).catch(() => []),
			readStoredRemoteNoteDocuments(roomId).catch(() => []),
			args.authUserId ? readCachedNoteShareCollaborators(args.authUserId, roomId).catch(() => null) : Promise.resolve(null),
		]);

		// Match against the same auxiliary stores the online search endpoint uses so
		// offline search still finds OCR text, URL previews, and collaborator labels.
		const collaboratorMatches = (collaboratorSnapshot?.collaborators ?? [])
			.map((collaborator) => [collaborator.user?.name, collaborator.user?.email].filter(Boolean).join(' ').trim())
			.filter((label) => includesQuery(label, normalizedQuery));
		const linkText = linkRows
			.map((link) => [link.title, link.description, link.mainContent, link.rootDomain, link.originalUrl].filter(Boolean).join(' '))
			.join(' ');
		const imageOcrText = imageRows.map((image) => image.ocrText || '').join(' ');
		// The name the user gave an image in the upload dialog — kept separate from
		// OCR text (see server /api/search) so a filename match doesn't show a
		// misleading "OCR" badge.
		const imageNameText = imageRows.map((image) => image.fileName || '').join(' ');
		const documentText = documentRows.map((document) => [document.fileName, document.ocrText].filter(Boolean).join(' ')).join(' ');

		const matchKinds: NoteSearchMatchKind[] = [];
		if (includesQuery(`${title} ${noteText}`, normalizedQuery)) matchKinds.push('note');
		if (includesQuery(imageOcrText, normalizedQuery)) matchKinds.push('ocr');
		if (includesQuery(imageNameText, normalizedQuery)) matchKinds.push('imageName');
		if (includesQuery(documentText, normalizedQuery)) matchKinds.push('document');
		if (includesQuery(linkText, normalizedQuery)) matchKinds.push('link');
		if (collaboratorMatches.length > 0) matchKinds.push('collaborator');
		if (includesQuery(collectionPath, normalizedQuery)) matchKinds.push('collection');
		if (labelMatches.length > 0) matchKinds.push('label');
		if (matchKinds.length === 0) return null;

		const snippetSource = matchKinds.includes('note')
			? `${title} ${noteText}`
			: matchKinds.includes('ocr')
				? imageOcrText
				: matchKinds.includes('imageName')
					? imageNameText
					: matchKinds.includes('document')
						? documentText
						: matchKinds.includes('link')
							? linkText
							: matchKinds.includes('collection')
								? collectionPath
								: matchKinds.includes('label')
									? labelMatches.join(' ')
							: collaboratorMatches.join(' ');

		const group: NoteSearchGroup = placement
			? { kind: 'shared', label: workspaceLabel, workspaceId }
			: { kind: 'workspace', label: workspaceLabel, workspaceId };

		return {
			docId: roomId,
			noteId,
			title: title || 'Untitled',
			archived: readArchiveState(doc).archived,
			group,
			matchKinds,
			collaboratorMatches,
			collectionMatches: collectionPath && includesQuery(collectionPath, normalizedQuery) ? [collectionPath] : [],
			labelMatches: labelMatches.slice(0, 4),
			snippet: buildSearchSnippet(snippetSource, normalizedQuery),
			imageCount: imageRows.length,
			thumbnailUrl: null,
			updatedAt: metadataUpdatedAtIso(doc),
			openWorkspaceId: workspaceId,
			openNoteId: noteId,
			folderName: placement?.folderName ?? null,
		};
	}));

	return results
		.filter((result): result is NoteSearchResult => Boolean(result))
		.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}