import { fetchJsonWithTimeout } from './network';

async function fetchJson<T>(
	input: RequestInfo | URL,
	init: RequestInit = {},
	options: { requestName?: string; timeoutMs?: number } = {}
): Promise<T> {
	return fetchJsonWithTimeout<T>(input, {
		credentials: 'include',
		requestName: options.requestName || 'note-media',
		timeoutMs: options.timeoutMs ?? 4000,
		...init,
	});
}

export type NoteImageRecord = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	mimeType: string;
	byteSize: number;
	width: number | null;
	height: number | null;
	thumbnailWidth: number | null;
	thumbnailHeight: number | null;
	sourceUrl: string | null;
	fileName: string | null;
	assetStatus: string;
	ocrStatus: string;
	ocrText: string;
	ocrError: string | null;
	createdAt: string;
	updatedAt: string;
	originalUrl: string;
	thumbnailUrl: string;
};

export type NoteImageListResponse = {
	images: NoteImageRecord[];
	count: number;
};

export type NoteSearchGroup = {
	kind: 'workspace' | 'shared-workspace' | 'shared';
	label: string;
	workspaceId: string | null;
};

export type NoteSearchMatchKind = 'note' | 'ocr' | 'collaborator' | 'link' | 'document' | 'collection' | 'label';

export type NoteSearchResult = {
	docId: string;
	noteId: string;
	title: string;
	archived: boolean;
	group: NoteSearchGroup;
	matchKinds: NoteSearchMatchKind[];
	collaboratorMatches: string[];
	collectionMatches: string[];
	labelMatches: string[];
	snippet: string;
	imageCount: number;
	thumbnailUrl: string | null;
	updatedAt: string;
	openWorkspaceId: string | null;
	openNoteId: string | null;
	folderName: string | null;
};

export type NoteSearchResponse = {
	query: string;
	results: NoteSearchResult[];
	count: number;
};

export async function listNoteImages(docId: string): Promise<NoteImageListResponse> {
	return fetchJson(`/api/note-media?docId=${encodeURIComponent(docId)}`, {}, {
		requestName: 'note-media-list',
		timeoutMs: 4000,
	});
}

export async function uploadNoteImages(docId: string, files: readonly File[]): Promise<NoteImageListResponse> {
	const formData = new FormData();
	formData.append('docId', docId);
	for (const file of files) {
		formData.append('file', file);
	}
	return fetchJson('/api/note-media', {
		method: 'POST',
		body: formData,
	}, {
		requestName: 'note-media-upload',
		timeoutMs: 90000,
	});
}

export async function importNoteImageUrl(docId: string, imageUrl: string): Promise<{ image: NoteImageRecord }> {
	return fetchJson('/api/note-media/import-url', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ docId, imageUrl }),
	}, {
		requestName: 'note-media-import-url',
		timeoutMs: 45000,
	});
}

export async function deleteNoteImage(imageId: string): Promise<{ ok: true; imageId: string }> {
	return fetchJson(`/api/note-media/${encodeURIComponent(imageId)}`, {
		method: 'DELETE',
	}, {
		requestName: 'note-media-delete',
		timeoutMs: 10000,
	});
}

export async function searchNotes(query: string): Promise<NoteSearchResponse> {
	return fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
}