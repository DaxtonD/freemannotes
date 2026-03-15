async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	// Small local wrapper so all document endpoints share cookie auth and error shaping.
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

export type NoteDocumentRecord = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	fileName: string;
	fileExtension: string;
	mimeType: string;
	byteSize: number;
	pageCount: number | null;
	previewWidth: number | null;
	previewHeight: number | null;
	thumbnailWidth: number | null;
	thumbnailHeight: number | null;
	ocrStatus: 'PENDING' | 'COMPLETE' | 'FAILED';
	ocrText: string;
	ocrError: string | null;
	createdAt: string;
	updatedAt: string;
	originalUrl: string;
	previewUrl: string;
	thumbnailUrl: string;
	viewerUrl: string;
	isLocal?: boolean;
	syncStatus?: 'synced' | 'queued' | 'failed';
	lastSyncError?: string | null;
};

export type NoteDocumentListResponse = {
	documents: NoteDocumentRecord[];
	count: number;
};

export async function listNoteDocuments(docId: string): Promise<NoteDocumentListResponse> {
	return fetchJson(`/api/note-documents?docId=${encodeURIComponent(docId)}`);
}

export async function uploadNoteDocuments(docId: string, files: readonly File[]): Promise<NoteDocumentListResponse> {
	const formData = new FormData();
	formData.append('docId', docId);
	for (const file of files) {
		formData.append('file', file);
	}
	return fetchJson('/api/note-documents', {
		method: 'POST',
		body: formData,
	});
}

export async function deleteNoteDocument(documentId: string): Promise<{ ok: true; documentId: string }> {
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}`, {
		method: 'DELETE',
	});
}