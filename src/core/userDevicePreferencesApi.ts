import type { LocaleCode } from './i18n';
import { normalizeEditorToolbarMode, type EditorToolbarMode } from './deviceAppearancePreferences';

export type UserDevicePreferences = {
	userId: string;
	deviceId: string;
	deleteAfterDays: number | null;
	theme: string | null;
	language: string | null;
	noteCardFontScale: number;
	noteEditorFontScale: number;
	editorToolbarMode: EditorToolbarMode;
	noteCardMaxHeightPx: number | null;
	activeWorkspaceId: string | null;
	activeSharedFolder: string | null;
	checklistShowCompleted: boolean;
	quickDeleteChecklist: boolean;
	noteCardClickOpens: boolean;
	noteCardCheckboxInteractions: boolean;
	noteCardLinkInteractions: boolean;
	noteCardCompletedInteractions: boolean;
	noteCardCompletedExpandedByNoteId: Record<string, boolean>;
	/** Per-user workspace bubble color overrides: { [workspaceId]: NoteColorToken } */
	bubbleWorkspaceColors: Record<string, string>;
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

/** Like safeJson but preserves string values (for e.g. bubbleWorkspaceColors). */
function safeJsonStringRecord(value: any): Record<string, string> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof k !== 'string' || !k) continue;
		if (typeof v === 'string' && v) out[k] = v;
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
		const legacyNoteCardInteractions = (body as any).noteCardClickOpens !== false;
		return {
			userId: String((body as any).userId || ''),
			deviceId: String((body as any).deviceId || deviceId),
			deleteAfterDays: normalizeDeleteAfterDays((body as any).deleteAfterDays),
			theme: (body as any).theme ? String((body as any).theme) : null,
			language: (body as any).language ? String((body as any).language) : null,
			noteCardFontScale: normalizeFontScale((body as any).noteCardFontScale),
			noteEditorFontScale: normalizeFontScale((body as any).noteEditorFontScale),
			editorToolbarMode: normalizeEditorToolbarMode((body as any).editorToolbarMode),
			noteCardMaxHeightPx: normalizeNoteCardMaxHeightPx((body as any).noteCardMaxHeightPx),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: legacyNoteCardInteractions,
			noteCardCheckboxInteractions: (body as any).noteCardCheckboxInteractions !== false && legacyNoteCardInteractions,
			noteCardLinkInteractions: (body as any).noteCardLinkInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedInteractions: (body as any).noteCardCompletedInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			bubbleWorkspaceColors: safeJsonStringRecord((body as any).bubbleWorkspaceColors),
			createdAt: (body as any).createdAt ? String((body as any).createdAt) : null,
			updatedAt: (body as any).updatedAt ? String((body as any).updatedAt) : null,
		};
	} catch {
		return null;
	}
}

type PreferencePatch = {
	deleteAfterDays?: number | null;
	theme?: string | null;
	language?: LocaleCode | null;
	noteCardFontScale?: number;
	noteEditorFontScale?: number;
	editorToolbarMode?: EditorToolbarMode;
	noteCardMaxHeightPx?: number | null;
	activeSharedFolder?: string | null;
	checklistShowCompleted?: boolean;
	quickDeleteChecklist?: boolean;
	noteCardClickOpens?: boolean;
	noteCardCheckboxInteractions?: boolean;
	noteCardLinkInteractions?: boolean;
	noteCardCompletedInteractions?: boolean;
	noteCardCompletedExpandedPatch?: { noteId: string; expanded: boolean };
	bubbleWorkspaceColors?: Record<string, string>;
};

const PREF_DEBOUNCE_MS = 1000;
let _pendingPatch: PreferencePatch = {};
let _pendingDeviceId: string | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingResolvers: Array<(result: UserDevicePreferences | null) => void> = [];

async function _flushPreferences(): Promise<void> {
	if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
	const deviceId = _pendingDeviceId;
	const patch = _pendingPatch;
	const resolvers = _pendingResolvers;
	_pendingDeviceId = null;
	_pendingPatch = {};
	_pendingResolvers = [];
	if (!deviceId || Object.keys(patch).length === 0) {
		resolvers.forEach(r => r(null));
		return;
	}
	const result = await _sendPreferences(deviceId, patch);
	resolvers.forEach(r => r(result));
}

async function _sendPreferences(
	deviceId: string,
	patch: PreferencePatch,
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
		const legacyNoteCardInteractions = (body as any).noteCardClickOpens !== false;
		return {
			userId: String((body as any).userId || ''),
			deviceId: String((body as any).deviceId || deviceId),
			deleteAfterDays: normalizeDeleteAfterDays((body as any).deleteAfterDays),
			theme: (body as any).theme ? String((body as any).theme) : null,
			language: (body as any).language ? String((body as any).language) : null,
			noteCardFontScale: normalizeFontScale((body as any).noteCardFontScale),
			noteEditorFontScale: normalizeFontScale((body as any).noteEditorFontScale),
			editorToolbarMode: normalizeEditorToolbarMode((body as any).editorToolbarMode),
			noteCardMaxHeightPx: normalizeNoteCardMaxHeightPx((body as any).noteCardMaxHeightPx),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: legacyNoteCardInteractions,
			noteCardCheckboxInteractions: (body as any).noteCardCheckboxInteractions !== false && legacyNoteCardInteractions,
			noteCardLinkInteractions: (body as any).noteCardLinkInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedInteractions: (body as any).noteCardCompletedInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			bubbleWorkspaceColors: safeJsonStringRecord((body as any).bubbleWorkspaceColors),
			createdAt: (body as any).createdAt ? String((body as any).createdAt) : null,
			updatedAt: (body as any).updatedAt ? String((body as any).updatedAt) : null,
		};
	} catch {
		return null;
	}
}

/** Immediately flush any pending debounced preference save.  Call after discrete
 *  user actions (e.g. color-picker selection) to ensure data is persisted even if
 *  the user navigates away within the normal 1-second debounce window. */
export function flushUserPreferences(): Promise<void> {
	return _flushPreferences();
}

export function updateUserPreferences(
	deviceId: string,
	patch: PreferencePatch,
): Promise<UserDevicePreferences | null> {
	return new Promise((resolve) => {
		// Different device → flush pending immediately so we don't mix devices.
		if (_pendingDeviceId && _pendingDeviceId !== deviceId) {
			void _flushPreferences();
		}
		_pendingDeviceId = deviceId;
		Object.assign(_pendingPatch, patch);
		_pendingResolvers.push(resolve);
		if (_debounceTimer) clearTimeout(_debounceTimer);
		_debounceTimer = setTimeout(() => void _flushPreferences(), PREF_DEBOUNCE_MS);
	});
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
