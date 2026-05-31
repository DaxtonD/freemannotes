import { logClientEvent } from './debugLogger';

const MOVE_DEBUG_STORAGE_KEY = 'freemannotes.moveDebug';
const TRACE_TTL_MS = 10 * 60 * 1000;

type MoveDebugTrace = {
	traceId: string;
	noteId: string;
	sourceWorkspaceId: string;
	targetWorkspaceId: string;
	sourceDocId: string;
	targetDocId: string;
	createdAt: number;
	updatedAt: number;
};

const tracesById = new Map<string, MoveDebugTrace>();
const traceIdByDocId = new Map<string, string>();

function parseToggle(value: unknown): boolean | null {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
	if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
	return null;
}

function isMoveDebugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		const url = new URL(window.location.href);
		// Keep live reproductions easy: a query flag can turn tracing on immediately,
		// then localStorage preserves the same setting across reloads while the issue is
		// being reproduced and the resulting traceId is collected.
		const queryValue = parseToggle(
			url.searchParams.get('moveDebug')
			?? url.searchParams.get('debugMove')
			?? url.searchParams.get('moveTrace')
		);
		if (queryValue !== null) {
			try {
				window.localStorage.setItem(MOVE_DEBUG_STORAGE_KEY, queryValue ? '1' : '0');
			} catch {
				// Best effort only.
			}
			return queryValue;
		}
	} catch {
		// ignore malformed location state
	}
	try {
		return parseToggle(window.localStorage.getItem(MOVE_DEBUG_STORAGE_KEY)) === true;
	} catch {
		return false;
	}
}

function createTraceId(): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}
	} catch {
		// ignore
	}
	return `move-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDocId(value: string | null | undefined): string {
	return typeof value === 'string' ? value.trim() : '';
}

function cleanupExpiredTraces(): void {
	const cutoff = Date.now() - TRACE_TTL_MS;
	for (const [traceId, trace] of tracesById.entries()) {
		if (trace.updatedAt >= cutoff) continue;
		tracesById.delete(traceId);
		for (const [docId, mappedTraceId] of traceIdByDocId.entries()) {
			if (mappedTraceId === traceId) {
				traceIdByDocId.delete(docId);
			}
		}
	}
}

function rememberDocIds(trace: MoveDebugTrace): void {
	traceIdByDocId.set(trace.sourceDocId, trace.traceId);
	traceIdByDocId.set(trace.targetDocId, trace.traceId);
	trace.updatedAt = Date.now();
	tracesById.set(trace.traceId, trace);
}

export function beginMoveDebugTrace(args: {
	noteId: string;
	sourceWorkspaceId: string;
	targetWorkspaceId: string;
}): MoveDebugTrace | null {
	if (!isMoveDebugEnabled()) return null;
	const noteId = String(args.noteId || '').trim();
	const sourceWorkspaceId = String(args.sourceWorkspaceId || '').trim();
	const targetWorkspaceId = String(args.targetWorkspaceId || '').trim();
	if (!noteId || !sourceWorkspaceId || !targetWorkspaceId) return null;
	cleanupExpiredTraces();
	const trace: MoveDebugTrace = {
		traceId: createTraceId(),
		noteId,
		sourceWorkspaceId,
		targetWorkspaceId,
		sourceDocId: `${sourceWorkspaceId}:${noteId}`,
		targetDocId: `${targetWorkspaceId}:${noteId}`,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	tracesById.set(trace.traceId, trace);
	rememberDocIds(trace);
	if (typeof console !== 'undefined') {
		console.info('[move-debug] trace started', {
			traceId: trace.traceId,
			noteId: trace.noteId,
			sourceWorkspaceId: trace.sourceWorkspaceId,
			targetWorkspaceId: trace.targetWorkspaceId,
			traceUrl: `/api/debug/move-trace?traceId=${encodeURIComponent(trace.traceId)}`,
		});
	}
	void logClientEvent('MOVE_DEBUG_TRACE_CREATED', {
		traceId: trace.traceId,
		noteId: trace.noteId,
		sourceWorkspaceId: trace.sourceWorkspaceId,
		targetWorkspaceId: trace.targetWorkspaceId,
		sourceDocId: trace.sourceDocId,
		targetDocId: trace.targetDocId,
	});
	return trace;
}

export function getMoveDebugTraceIdForDocId(docId: string | null | undefined): string | null {
	cleanupExpiredTraces();
	const normalizedDocId = normalizeDocId(docId);
	if (!normalizedDocId) return null;
	const traceId = traceIdByDocId.get(normalizedDocId) ?? null;
	if (!traceId) return null;
	const trace = tracesById.get(traceId) ?? null;
	if (!trace) {
		traceIdByDocId.delete(normalizedDocId);
		return null;
	}
	trace.updatedAt = Date.now();
	tracesById.set(traceId, trace);
	return traceId;
}

export function appendMoveDebugQuery(input: string, traceId: string | null | undefined): string {
	const normalizedTraceId = typeof traceId === 'string' ? traceId.trim() : '';
	if (!normalizedTraceId) return input;
	try {
		const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
		const url = new URL(input, base);
		url.searchParams.set('debugTraceId', normalizedTraceId);
		if (/^https?:/i.test(input)) return url.toString();
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		const separator = input.includes('?') ? '&' : '?';
		return `${input}${separator}debugTraceId=${encodeURIComponent(normalizedTraceId)}`;
	}
}

export function logMoveDebugClient(traceId: string | null | undefined, phase: string, data: Record<string, unknown> = {}): void {
	const normalizedTraceId = typeof traceId === 'string' ? traceId.trim() : '';
	if (!normalizedTraceId || !phase) return;
	if (typeof console !== 'undefined' && isMoveDebugEnabled()) {
		console.info('[move-debug]', phase, { traceId: normalizedTraceId, ...data });
	}
	void logClientEvent('MOVE_DEBUG_CLIENT', {
		traceId: normalizedTraceId,
		phase,
		...data,
	});
}