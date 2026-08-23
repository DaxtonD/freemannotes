import type { ExtractedNoteLink } from './noteLinks';
import { fetchWithTimeout } from './network';

type HttpError = Error & { status?: number };

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	// Shared wrapper so link-preview endpoints behave like the rest of the authenticated API.
	// fetchWithTimeout, not bare fetch() — a stalled "online but not really" mobile
	// connection just hangs forever otherwise, no error, no timeout, nothing. Found this
	// same landmine in about ten other files this pass. Enough.
	const response = await fetchWithTimeout(input, {
		credentials: 'include',
		...init,
		timeoutMs: 8000,
	});
	const contentType = String(response.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		const error = new Error(message) as HttpError;
		error.status = response.status;
		throw error;
	}
	return body as T;
}

export type NoteLinkRecord = {
	id: string;
	docId: string;
	sourceWorkspaceId: string;
	sourceNoteId: string;
	normalizedUrl: string;
	originalUrl: string;
	hostname: string;
	rootDomain: string;
	siteName: string | null;
	title: string | null;
	description: string | null;
	mainContent: string | null;
	imageUrl: string | null;
	metadataJson: Record<string, unknown> | null;
	imageUrls: string[];
	sortOrder: number;
	status: 'PENDING' | 'READY' | 'FAILED';
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

export type NoteLinkListResponse = {
	links: NoteLinkRecord[];
	count: number;
};

export type FailedNoteLinkRecord = {
	id: string;
	docId: string;
	noteId: string;
	noteTitle: string;
	originalUrl: string;
	rootDomain: string;
	errorMessage: string;
	updatedAt: string;
	openWorkspaceId: string | null;
	openNoteId: string | null;
	folderName: string | null;
};

export type FailedNoteLinkResponse = {
	failures: FailedNoteLinkRecord[];
	count: number;
};

export async function listNoteLinks(docId: string): Promise<NoteLinkListResponse> {
	return fetchJson(`/api/note-links?docId=${encodeURIComponent(docId)}`);
}

export async function syncNoteLinks(docId: string, links: readonly ExtractedNoteLink[]): Promise<NoteLinkListResponse> {
	return fetchJson('/api/note-links/sync', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			docId,
			links: links.map((link) => ({ url: link.url, sortOrder: link.sortOrder })),
		}),
	});
}

export async function listFailedNoteLinks(): Promise<FailedNoteLinkResponse> {
	return fetchJson('/api/note-links/failures');
}

export type FlushOrphanedNoteLinkPreviewsResponse = {
	removed: number;
	checked: number;
};

export async function flushOrphanedNoteLinkPreviews(): Promise<FlushOrphanedNoteLinkPreviewsResponse> {
	return fetchJson('/api/note-links/flush-orphaned', { method: 'POST' });
}