import type { MoveNoteMetadataMapping } from './noteMoveMetadata';
import { fetchWithTimeout } from './network';

type MoveNoteResponse = {
	noteId: string;
	sourceWorkspaceId: string;
	targetWorkspaceId: string;
	docId: string;
};

type EmptyTrashResponse = {
	deletedCount: number;
	noteIds: string[];
};

export type AboutHudStatsResponse = {
	status: 'ok' | 'degraded';
	generatedAt: string;
	uptimeSeconds: number;
	process: {
		nodeVersion: string;
		pid: number;
		rssBytes: number;
		heapUsedBytes: number;
		heapTotalBytes: number;
	};
	totals: {
		users: number;
		workspaces: number;
		documents: number;
		dbStateBytes: number;
		noteImagesBytes: number;
		noteDocumentsBytes: number;
		uploadBytes: number;
		noteImagesCount: number;
		noteDocumentsCount: number;
	};
};

type HttpError = Error & { status?: number };

function withHttpStatus(message: string, status: number): HttpError {
	const error = new Error(message) as HttpError;
	error.status = status;
	return error;
}

async function fetchJson<T>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
	// Move Note and Empty Trash both leave a busy flag set indefinitely on a hang — a
	// hard timeout turns a stalled "technically online" mobile connection into a real
	// rejection callers already handle, instead of a stuck button forever.
	const response = await fetchWithTimeout(input, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(init.headers || {}),
		},
		...init,
		timeoutMs: 8000,
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw withHttpStatus(message, response.status);
	}
	return body as T;
}

export async function moveNoteToWorkspace(
	noteId: string,
	targetWorkspaceId: string,
	sourceWorkspaceId?: string | null,
	metadataMapping?: MoveNoteMetadataMapping | null,
	debugTraceId?: string | null,
): Promise<MoveNoteResponse> {
	return fetchJson(`/api/notes/${encodeURIComponent(noteId)}/move`, {
		method: 'POST',
		body: JSON.stringify({
			targetWorkspaceId,
			sourceWorkspaceId: typeof sourceWorkspaceId === 'string' ? sourceWorkspaceId.trim() : undefined,
			metadataMapping: metadataMapping ?? undefined,
			debugTraceId: typeof debugTraceId === 'string' && debugTraceId.trim() ? debugTraceId.trim() : undefined,
		}),
	});
}

export async function emptyTrashNow(): Promise<EmptyTrashResponse> {
	return fetchJson('/api/trash/empty', {
		method: 'POST',
		body: JSON.stringify({}),
	});
}

export async function fetchAboutHudStats(): Promise<AboutHudStatsResponse> {
	return fetchJson('/api/system/hud-stats', {
		method: 'GET',
	});
}

export async function devClearAllNotifications(): Promise<{ deleted: number }> {
	return fetchJson('/api/dev/clear-notifications', { method: 'POST' });
}

export async function devClearInbox(): Promise<{ archived: number }> {
	return fetchJson('/api/dev/clear-inbox', { method: 'POST' });
}