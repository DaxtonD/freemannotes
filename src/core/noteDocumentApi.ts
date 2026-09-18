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
	/**
	 * A record built for an older version rather than the document's current one. Only the latest
	 * version is kept on the device (D3), so these are fetched when opened and never cached — saving
	 * one would overwrite the offline copy of the version everyone else is actually working on.
	 */
	isOlderVersion?: boolean;
};

export type NoteDocumentListResponse = {
	documents: NoteDocumentRecord[];
	count: number;
};

export async function listNoteDocuments(docId: string): Promise<NoteDocumentListResponse> {
	return fetchJson(`/api/note-documents?docId=${encodeURIComponent(docId)}`);
}

/** A document as the manifest lists it: the same record minus the (possibly huge) extracted text. */
export type NoteDocumentManifestEntry = Omit<NoteDocumentRecord, 'ocrText' | 'isLocal' | 'syncStatus' | 'lastSyncError' | 'syncPermanentFailure'>;

export type NoteDocumentManifestResponse = {
	/** Server time taken before it looked; anything newer may not be listed yet. */
	generatedAt: string;
	documents: NoteDocumentManifestEntry[];
	count: number;
};

/** Every document this user can see, across all their workspaces and shared notes. */
export async function fetchNoteDocumentManifest(): Promise<NoteDocumentManifestResponse> {
	return fetchJson('/api/note-documents/manifest', {}, { timeoutMs: 20000 });
}

export type DocumentConversionStatus = {
	configured: boolean;
	state: 'off' | 'connected' | 'unreachable' | 'auth' | 'libreoffice-down';
	version: string | null;
	checkedAt: string;
};

/** Is the server's document converter (Gotenberg) up? `refresh` skips the server's short cache. */
export async function fetchDocumentConversionStatus(refresh = false): Promise<DocumentConversionStatus> {
	return fetchJson(`/api/document-conversion/status${refresh ? '?refresh=1' : ''}`, {}, { timeoutMs: 10000 });
}

// A flat 90 s cut big prints off halfway on a slow connection, and the queue then started them
// again from zero, forever. Allow 90 s plus a second for every 128 KB (a 1 Mbps floor).
function uploadTimeoutMs(files: readonly File[]): number {
	const bytes = files.reduce((total, file) => total + file.size, 0);
	return 90_000 + Math.ceil(bytes / (128 * 1024)) * 1000;
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
	}, { timeoutMs: uploadTimeoutMs(files) });
}

/** One revision of a document. Markup belongs to the version it was drawn on (D7). */
export type NoteDocumentVersionRecord = {
	id: string;
	versionNumber: number;
	uploadedByUserId: string;
	fileName: string;
	fileExtension: string;
	mimeType: string;
	byteSize: number;
	pageCount: number | null;
	createdAt: string;
	conversionStatus: NoteDocumentConversionStatus;
	/** Someone has marked this version up, so housekeeping will never remove it on its own. */
	hasMarkup: boolean;
	viewPdfUrl: string | null;
	originalUrl: string;
	previewUrl: string;
	thumbnailUrl: string;
};

export type NoteDocumentVersionListResponse = {
	documentId: string;
	latestVersionNumber: number;
	/** How many recent versions are kept automatically. */
	keepAutomatically: number;
	/** Newest first. */
	versions: NoteDocumentVersionRecord[];
};

export async function listNoteDocumentVersions(documentId: string): Promise<NoteDocumentVersionListResponse> {
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}/versions`, {}, { timeoutMs: 15000 });
}

/** Replaces a document with a new revision. The old versions (and their markup) stay in the history. */
export async function uploadNoteDocumentVersion(
	documentId: string,
	file: File,
): Promise<NoteDocumentVersionListResponse & { document: NoteDocumentRecord; prunedVersionIds: string[] }> {
	const formData = new FormData();
	formData.append('file', file);
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}/versions`, {
		method: 'POST',
		body: formData,
	}, { timeoutMs: uploadTimeoutMs([file]) });
}

export async function deleteNoteDocumentVersion(documentId: string, versionId: string): Promise<NoteDocumentVersionListResponse & { ok: true }> {
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}`, {
		method: 'DELETE',
	}, { timeoutMs: 15000 });
}

export async function deleteNoteDocument(documentId: string): Promise<{ ok: true; documentId: string }> {
	return fetchJson(`/api/note-documents/${encodeURIComponent(documentId)}`, {
		method: 'DELETE',
	});
}
