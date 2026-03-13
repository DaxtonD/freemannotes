async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	const response = await fetch(input, {
		credentials: 'include',
		...init,
	});
	const contentType = String(response.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw new Error(message);
	}
	return body as T;
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

export type NoteSearchMatchKind = 'note' | 'ocr' | 'collaborator';

export type NoteSearchResult = {
	docId: string;
	noteId: string;
	title: string;
	archived: boolean;
	group: NoteSearchGroup;
	matchKinds: NoteSearchMatchKind[];
	collaboratorMatches: string[];
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
	return fetchJson(`/api/note-media?docId=${encodeURIComponent(docId)}`);
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
	});
}

export async function importNoteImageUrl(docId: string, imageUrl: string): Promise<{ image: NoteImageRecord }> {
	return fetchJson('/api/note-media/import-url', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ docId, imageUrl }),
	});
}

export async function deleteNoteImage(imageId: string): Promise<{ ok: true; imageId: string }> {
	return fetchJson(`/api/note-media/${encodeURIComponent(imageId)}`, {
		method: 'DELETE',
	});
}

export async function searchNotes(query: string): Promise<NoteSearchResponse> {
	return fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
}