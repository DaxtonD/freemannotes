import { fetchWithTimeout } from './network';

/** Carries the HTTP status so callers can tell "the server said no" from "the network fell over". */
export class NoteDocumentApiError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'NoteDocumentApiError';
		this.status = status;
	}
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}, options: { timeoutMs?: number } = {}): Promise<T> {
	// Small local wrapper so all document endpoints share cookie auth and error shaping.
	// Default timeout suits the list/delete reads; uploadNoteDocuments overrides it below
	// since a document upload legitimately needs longer than a "stalled connection" cutoff.
	const response = await fetchWithTimeout(input, {
		credentials: 'include',
		...init,
		timeoutMs: options.timeoutMs ?? 8000,
	});
	const contentType = String(response.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw new NoteDocumentApiError(message, response.status);
	}
	return body as T;
}

export type NoteDocumentConversionStatus = 'NOT_NEEDED' | 'PENDING' | 'COMPLETE' | 'FAILED';

/**
 * One document on a note, as the list endpoint returns it. The file fields
 * (fileName, byteSize, originalUrl, …) describe the latest version; older versions
 * come from their own endpoint in a later stage.
 */
export type NoteDocumentRecord = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	versionCount?: number;
	latestVersionId?: string;
	latestVersionNumber?: number;
	uploadedByUserId?: string;
	versionCreatedAt?: string;
	conversionStatus?: NoteDocumentConversionStatus;
	viewPdfUrl?: string | null;
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
	isLocal?: boolean;
	syncStatus?: 'synced' | 'queued' | 'failed';
	lastSyncError?: string | null;
	/** The server rejected this upload outright (bad type, too big) — retrying won't help. */
	syncPermanentFailure?: boolean;
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
	}, { timeoutMs: 90000 });
}

export async function deleteNoteDocument(documentId: string): Promise<{ ok: true; documentId: string }> {
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}`, {
		method: 'DELETE',
	});
}
