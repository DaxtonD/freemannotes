import { moveNoteToWorkspace } from './noteManagementApi';

export type PendingNoteMove = {
	id: string;
	userId: string;
	noteId: string;
	sourceWorkspaceId: string;
	targetWorkspaceId: string;
	title: string | null;
	createdAt: string;
	updatedAt: string;
};

const STORAGE_KEY_PREFIX = 'freemannotes.note.pending-moves.v1:';

function storageKey(userId: string): string {
	return `${STORAGE_KEY_PREFIX}${userId}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function normalizeTitle(value: unknown): string | null {
	const title = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
	return title.length > 0 ? title : null;
}

function readQueue(userId: string): PendingNoteMove[] {
	if (typeof window === 'undefined') return [];
	const normalizedUserId = normalizeId(userId);
	if (!normalizedUserId) return [];
	try {
		const raw = window.localStorage.getItem(storageKey(normalizedUserId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
			.map((item) => {
				const noteId = normalizeId(item.noteId);
				const sourceWorkspaceId = normalizeId(item.sourceWorkspaceId);
				const targetWorkspaceId = normalizeId(item.targetWorkspaceId);
				const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : nowIso();
				const updatedAt = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt;
				return {
					id: normalizeId(item.id) || `note-move:${noteId}`,
					userId: normalizedUserId,
					noteId,
					sourceWorkspaceId,
					targetWorkspaceId,
					title: normalizeTitle(item.title),
					createdAt,
					updatedAt,
				};
			})
			.filter((item) => item.noteId && item.sourceWorkspaceId && item.targetWorkspaceId)
			.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
	} catch {
		return [];
	}
}

function writeQueue(userId: string, moves: readonly PendingNoteMove[]): void {
	if (typeof window === 'undefined') return;
	const normalizedUserId = normalizeId(userId);
	if (!normalizedUserId) return;
	try {
		if (moves.length === 0) {
			window.localStorage.removeItem(storageKey(normalizedUserId));
			return;
		}
		window.localStorage.setItem(storageKey(normalizedUserId), JSON.stringify(moves));
	} catch {
		// Best-effort persistence only.
	}
	}

export function readPendingNoteMoves(userId: string): PendingNoteMove[] {
	return readQueue(userId);
}

export function removePendingNoteMove(userId: string, noteId: string): void {
	const normalizedUserId = normalizeId(userId);
	const normalizedNoteId = normalizeId(noteId);
	if (!normalizedUserId || !normalizedNoteId) return;
	const remaining = readQueue(normalizedUserId).filter((item) => item.noteId !== normalizedNoteId);
	writeQueue(normalizedUserId, remaining);
}

export function queuePendingNoteMove(args: {
	userId: string;
	noteId: string;
	sourceWorkspaceId: string;
	targetWorkspaceId: string;
	title?: string | null;
}): PendingNoteMove | null {
	const userId = normalizeId(args.userId);
	const noteId = normalizeId(args.noteId);
	const sourceWorkspaceId = normalizeId(args.sourceWorkspaceId);
	const targetWorkspaceId = normalizeId(args.targetWorkspaceId);
	if (!userId || !noteId || !sourceWorkspaceId || !targetWorkspaceId) return null;

	const queue = readQueue(userId);
	const existing = queue.find((item) => item.noteId === noteId) ?? null;
	const originalSourceWorkspaceId = existing?.sourceWorkspaceId || sourceWorkspaceId;
	if (originalSourceWorkspaceId === targetWorkspaceId) {
		const filtered = queue.filter((item) => item.noteId !== noteId);
		writeQueue(userId, filtered);
		return null;
	}

	const next: PendingNoteMove = {
		id: existing?.id || `note-move:${noteId}`,
		userId,
		noteId,
		sourceWorkspaceId: originalSourceWorkspaceId,
		targetWorkspaceId,
		title: normalizeTitle(args.title),
		createdAt: existing?.createdAt || nowIso(),
		updatedAt: nowIso(),
	};

	writeQueue(
		userId,
		[...queue.filter((item) => item.noteId !== noteId), next].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
	);
	return next;
}

export async function flushPendingNoteMoves(userId: string): Promise<void> {
	const normalizedUserId = normalizeId(userId);
	if (!normalizedUserId) return;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

	const pending = readQueue(normalizedUserId);
	for (const move of pending) {
		try {
			await moveNoteToWorkspace(move.noteId, move.targetWorkspaceId, move.sourceWorkspaceId);
			removePendingNoteMove(normalizedUserId, move.noteId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error ?? '');
			const status = typeof (error as { status?: unknown } | null | undefined)?.status === 'number'
				? (error as { status: number }).status
				: null;
			if (status === 409) {
				removePendingNoteMove(normalizedUserId, move.noteId);
				continue;
			}
			if (/failed to fetch|networkerror|load failed/i.test(message)) {
				break;
			}
			break;
		}
	}
}