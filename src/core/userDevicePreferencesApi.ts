import type { LocaleCode } from './i18n';

export type UserDevicePreferences = {
	userId: string;
	deviceId: string;
	deleteAfterDays: number | null;
	theme: string | null;
	language: string | null;
	noteCardFontScale: number;
	noteEditorFontScale: number;
	noteCardMaxHeightPx: number | null;
	activeWorkspaceId: string | null;
	activeSharedFolder: string | null;
	checklistShowCompleted: boolean;
	quickDeleteChecklist: boolean;
	noteCardClickOpens: boolean;
	noteCardCompletedExpandedByNoteId: Record<string, boolean>;
	createdAt: string | null;
	updatedAt: string | null;
};

function safeJson(value: any): Record<string, boolean> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, boolean> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof k !== 'string' || !k) continue;
		out[k] = Boolean(v);
	}
	return out;
}

function normalizeFontScale(value: unknown): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return 1;
	return Math.min(1.5, Math.max(0.75, parsed));
}

function normalizeNoteCardMaxHeightPx(value: unknown): number | null {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return null;
	return Math.round(parsed);
}

function normalizeDeleteAfterDays(value: unknown): number | null {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
	return parsed;
}

export async function fetchUserPreferences(deviceId: string): Promise<UserDevicePreferences | null> {
	try {
		const url = `/api/user/preferences?deviceId=${encodeURIComponent(deviceId)}`;
		const res = await fetch(url, { credentials: 'include' });
		const contentType = String(res.headers.get('content-type') || '').toLowerCase();
		if (!res.ok || !contentType.includes('application/json')) return null;
		const body = await res.json().catch(() => null);
		if (!body || typeof body !== 'object') return null;
		return {
			userId: String((body as any).userId || ''),
			deviceId: String((body as any).deviceId || deviceId),
			deleteAfterDays: normalizeDeleteAfterDays((body as any).deleteAfterDays),
			theme: (body as any).theme ? String((body as any).theme) : null,
			language: (body as any).language ? String((body as any).language) : null,
			noteCardFontScale: normalizeFontScale((body as any).noteCardFontScale),
			noteEditorFontScale: normalizeFontScale((body as any).noteEditorFontScale),
			noteCardMaxHeightPx: normalizeNoteCardMaxHeightPx((body as any).noteCardMaxHeightPx),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: (body as any).noteCardClickOpens !== false,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			createdAt: (body as any).createdAt ? String((body as any).createdAt) : null,
			updatedAt: (body as any).updatedAt ? String((body as any).updatedAt) : null,
		};
	} catch {
		return null;
	}
}

export async function updateUserPreferences(
	deviceId: string,
	patch: {
		deleteAfterDays?: number | null;
		theme?: string | null;
		language?: LocaleCode | null;
		noteCardFontScale?: number;
		noteEditorFontScale?: number;
		noteCardMaxHeightPx?: number | null;
		activeSharedFolder?: string | null;
		checklistShowCompleted?: boolean;
		quickDeleteChecklist?: boolean;
		noteCardClickOpens?: boolean;
		noteCardCompletedExpandedPatch?: { noteId: string; expanded: boolean };
	}
): Promise<UserDevicePreferences | null> {
	try {
		const url = `/api/user/preferences?deviceId=${encodeURIComponent(deviceId)}`;
		const res = await fetch(url, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		});
		const contentType = String(res.headers.get('content-type') || '').toLowerCase();
		if (!res.ok || !contentType.includes('application/json')) return null;
		const body = await res.json().catch(() => null);
		if (!body || typeof body !== 'object') return null;
		return {
			userId: String((body as any).userId || ''),
			deviceId: String((body as any).deviceId || deviceId),
			deleteAfterDays: normalizeDeleteAfterDays((body as any).deleteAfterDays),
			theme: (body as any).theme ? String((body as any).theme) : null,
			language: (body as any).language ? String((body as any).language) : null,
			noteCardFontScale: normalizeFontScale((body as any).noteCardFontScale),
			noteEditorFontScale: normalizeFontScale((body as any).noteEditorFontScale),
			noteCardMaxHeightPx: normalizeNoteCardMaxHeightPx((body as any).noteCardMaxHeightPx),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: (body as any).noteCardClickOpens !== false,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			createdAt: (body as any).createdAt ? String((body as any).createdAt) : null,
			updatedAt: (body as any).updatedAt ? String((body as any).updatedAt) : null,
		};
	} catch {
		return null;
	}
}

export async function activateWorkspace(deviceId: string, workspaceId: string): Promise<string | null> {
	try {
		const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ deviceId }),
		});
		const contentType = String(res.headers.get('content-type') || '').toLowerCase();
		if (!res.ok || !contentType.includes('application/json')) return null;
		const body = await res.json().catch(() => null);
		return body?.activeWorkspaceId ? String(body.activeWorkspaceId) : null;
	} catch {
		return null;
	}
}
