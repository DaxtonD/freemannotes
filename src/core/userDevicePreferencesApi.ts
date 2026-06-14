import type { LocaleCode } from './i18n';
import {
	normalizeEditorToolbarMode,
	normalizeNoteCardBannerTitlePosition,
	type EditorToolbarMode,
	type NoteCardBannerTitlePosition,
} from './deviceAppearancePreferences';

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
	noteCardBannerTitlePosition: NoteCardBannerTitlePosition;
	activeWorkspaceId: string | null;
	activeSharedFolder: string | null;
	checklistShowCompleted: boolean;
	quickDeleteChecklist: boolean;
	noteCardClickOpens: boolean;
	noteCardCheckboxInteractions: boolean;
	noteCardLinkInteractions: boolean;
	noteCardCompletedInteractions: boolean;
	noteCardCompletedExpandedByNoteId: Record<string, boolean>;
	collapsedRichHeadingIds: Record<string, boolean>;
	/** Per-user workspace bubble color overrides: { [workspaceId]: NoteColorToken } */
	bubbleWorkspaceColors: Record<string, string>;
	/** Per-user note color overrides: { [noteId]: NoteColorToken | null } */
	noteColorsByNoteId: Record<string, string | null>;
	/** Per-user note banner overrides: { [noteId]: bannerFileName | null } */
	noteBannersByNoteId: Record<string, string | null>;
	/** Per-user note pin overrides keyed by concrete docId: { [docId]: boolean } */
	notePinsByDocId: Record<string, boolean>;
	/** Per-user dismissed failed-link notification IDs: { [failedLinkId]: true } */
	dismissedFailedLinkIds: Record<string, boolean>;
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

function safeStrictBooleanRecord(value: any): Record<string, boolean> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, boolean> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof k !== 'string' || !k) continue;
		if (typeof v === 'boolean') out[k] = v;
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

function safeJsonNullableStringRecord(value: any): Record<string, string | null> {
	if (!value || typeof value !== 'object') return {};
	const out: Record<string, string | null> = {};
	for (const [k, v] of Object.entries(value)) {
		if (typeof k !== 'string' || !k) continue;
		if (v == null || v === '') {
			out[k] = null;
			continue;
		}
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
		const pref: UserDevicePreferences = {
			userId: String((body as any).userId || ''),
			deviceId: String((body as any).deviceId || deviceId),
			deleteAfterDays: normalizeDeleteAfterDays((body as any).deleteAfterDays),
			theme: (body as any).theme ? String((body as any).theme) : null,
			language: (body as any).language ? String((body as any).language) : null,
			noteCardFontScale: normalizeFontScale((body as any).noteCardFontScale),
			noteEditorFontScale: normalizeFontScale((body as any).noteEditorFontScale),
			editorToolbarMode: normalizeEditorToolbarMode((body as any).editorToolbarMode),
			noteCardMaxHeightPx: normalizeNoteCardMaxHeightPx((body as any).noteCardMaxHeightPx),
			noteCardBannerTitlePosition: normalizeNoteCardBannerTitlePosition((body as any).noteCardBannerTitlePosition),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: legacyNoteCardInteractions,
			noteCardCheckboxInteractions: (body as any).noteCardCheckboxInteractions !== false && legacyNoteCardInteractions,
			noteCardLinkInteractions: (body as any).noteCardLinkInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedInteractions: (body as any).noteCardCompletedInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			collapsedRichHeadingIds: safeJson((body as any).collapsedRichHeadingIds),
			bubbleWorkspaceColors: safeJsonStringRecord((body as any).bubbleWorkspaceColors),
			noteColorsByNoteId: safeJsonNullableStringRecord((body as any).noteColorsByNoteId),
			noteBannersByNoteId: safeJsonNullableStringRecord((body as any).noteBannersByNoteId),
			notePinsByDocId: safeStrictBooleanRecord((body as any).notePinsByDocId),
			dismissedFailedLinkIds: safeJson((body as any).dismissedFailedLinkIds),
			createdAt: (body as any).createdAt ? String((body as any).createdAt) : null,
			updatedAt: (body as any).updatedAt ? String((body as any).updatedAt) : null,
		};
		const pendingPatch = mergePreferencePatches(
			readPersistedPendingPatch(deviceId),
			_pendingDeviceId === deviceId ? _pendingPatch : {},
		);
		return applyPendingPatchToPreferences(pref, pendingPatch);
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
	noteCardBannerTitlePosition?: NoteCardBannerTitlePosition;
	activeSharedFolder?: string | null;
	checklistShowCompleted?: boolean;
	quickDeleteChecklist?: boolean;
	noteCardClickOpens?: boolean;
	noteCardCheckboxInteractions?: boolean;
	noteCardLinkInteractions?: boolean;
	noteCardCompletedInteractions?: boolean;
	noteCardCompletedExpandedPatch?: { noteId: string; expanded: boolean };
	collapsedRichHeadingIds?: Record<string, boolean>;
	bubbleWorkspaceColors?: Record<string, string>;
	noteColorsByNoteId?: Record<string, string | null>;
	noteBannersByNoteId?: Record<string, string | null>;
	notePinsByDocId?: Record<string, boolean>;
	dismissedFailedLinkIds?: Record<string, boolean>;
};

const PENDING_PREFERENCES_STORAGE_KEY_PREFIX = 'freemannotes.pendingUserPreferencesPatch.v1';

function getPendingPreferencesStorageKey(deviceId: string): string {
	return `${PENDING_PREFERENCES_STORAGE_KEY_PREFIX}:${deviceId}`;
}

function hasPatchEntries(patch: PreferencePatch | null | undefined): patch is PreferencePatch {
	return Boolean(patch && Object.keys(patch).length > 0);
}

function mergePreferencePatches(base: PreferencePatch, overlay: PreferencePatch): PreferencePatch {
	return { ...base, ...overlay };
}

function readPersistedPendingPatch(deviceId: string): PreferencePatch {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(getPendingPreferencesStorageKey(deviceId));
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? parsed as PreferencePatch
			: {};
	} catch {
		return {};
	}
}

function persistPendingPatch(deviceId: string, patch: PreferencePatch): void {
	try {
		if (typeof localStorage === 'undefined') return;
		if (!hasPatchEntries(patch)) {
			localStorage.removeItem(getPendingPreferencesStorageKey(deviceId));
			return;
		}
		localStorage.setItem(getPendingPreferencesStorageKey(deviceId), JSON.stringify(patch));
	} catch {
		// Ignore localStorage errors.
	}
}

function applyPendingPatchToPreferences(pref: UserDevicePreferences, patch: PreferencePatch): UserDevicePreferences {
	if (!hasPatchEntries(patch)) return pref;
	const next: UserDevicePreferences = {
		...pref,
		noteCardCompletedExpandedByNoteId: { ...pref.noteCardCompletedExpandedByNoteId },
		collapsedRichHeadingIds: { ...pref.collapsedRichHeadingIds },
		bubbleWorkspaceColors: { ...pref.bubbleWorkspaceColors },
		noteColorsByNoteId: { ...pref.noteColorsByNoteId },
		noteBannersByNoteId: { ...pref.noteBannersByNoteId },
		notePinsByDocId: { ...pref.notePinsByDocId },
		dismissedFailedLinkIds: { ...pref.dismissedFailedLinkIds },
	};
	if ('deleteAfterDays' in patch) next.deleteAfterDays = patch.deleteAfterDays ?? null;
	if ('theme' in patch) next.theme = patch.theme ?? null;
	if ('language' in patch) next.language = patch.language ?? null;
	if ('noteCardFontScale' in patch && typeof patch.noteCardFontScale === 'number') next.noteCardFontScale = normalizeFontScale(patch.noteCardFontScale);
	if ('noteEditorFontScale' in patch && typeof patch.noteEditorFontScale === 'number') next.noteEditorFontScale = normalizeFontScale(patch.noteEditorFontScale);
	if ('editorToolbarMode' in patch && patch.editorToolbarMode) next.editorToolbarMode = normalizeEditorToolbarMode(patch.editorToolbarMode);
	if ('noteCardMaxHeightPx' in patch) next.noteCardMaxHeightPx = normalizeNoteCardMaxHeightPx(patch.noteCardMaxHeightPx);
	if ('noteCardBannerTitlePosition' in patch) next.noteCardBannerTitlePosition = normalizeNoteCardBannerTitlePosition(patch.noteCardBannerTitlePosition);
	if ('activeSharedFolder' in patch) next.activeSharedFolder = patch.activeSharedFolder ?? null;
	if ('checklistShowCompleted' in patch && typeof patch.checklistShowCompleted === 'boolean') next.checklistShowCompleted = patch.checklistShowCompleted;
	if ('quickDeleteChecklist' in patch && typeof patch.quickDeleteChecklist === 'boolean') next.quickDeleteChecklist = patch.quickDeleteChecklist;
	if ('noteCardClickOpens' in patch && typeof patch.noteCardClickOpens === 'boolean') next.noteCardClickOpens = patch.noteCardClickOpens;
	if ('noteCardCheckboxInteractions' in patch && typeof patch.noteCardCheckboxInteractions === 'boolean') next.noteCardCheckboxInteractions = patch.noteCardCheckboxInteractions;
	if ('noteCardLinkInteractions' in patch && typeof patch.noteCardLinkInteractions === 'boolean') next.noteCardLinkInteractions = patch.noteCardLinkInteractions;
	if ('noteCardCompletedInteractions' in patch && typeof patch.noteCardCompletedInteractions === 'boolean') next.noteCardCompletedInteractions = patch.noteCardCompletedInteractions;
	if (patch.noteCardCompletedExpandedPatch?.noteId) {
		next.noteCardCompletedExpandedByNoteId[patch.noteCardCompletedExpandedPatch.noteId] = Boolean(patch.noteCardCompletedExpandedPatch.expanded);
	}
	if ('collapsedRichHeadingIds' in patch && patch.collapsedRichHeadingIds) next.collapsedRichHeadingIds = safeJson(patch.collapsedRichHeadingIds);
	if ('bubbleWorkspaceColors' in patch && patch.bubbleWorkspaceColors) next.bubbleWorkspaceColors = { ...patch.bubbleWorkspaceColors };
	if ('noteColorsByNoteId' in patch && patch.noteColorsByNoteId) next.noteColorsByNoteId = { ...patch.noteColorsByNoteId };
	if ('noteBannersByNoteId' in patch && patch.noteBannersByNoteId) next.noteBannersByNoteId = { ...patch.noteBannersByNoteId };
	if ('notePinsByDocId' in patch && patch.notePinsByDocId) next.notePinsByDocId = safeStrictBooleanRecord(patch.notePinsByDocId);
	if ('dismissedFailedLinkIds' in patch && patch.dismissedFailedLinkIds) next.dismissedFailedLinkIds = { ...patch.dismissedFailedLinkIds };
	return next;
}

const PREF_DEBOUNCE_MS = 1000;
let _pendingPatch: PreferencePatch = {};
let _pendingDeviceId: string | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingResolvers: Array<(result: UserDevicePreferences | null) => void> = [];

function ensurePendingPatchLoaded(deviceId: string): void {
	const persisted = readPersistedPendingPatch(deviceId);
	if (!hasPatchEntries(persisted)) return;
	_pendingPatch = mergePreferencePatches(persisted, _pendingPatch);
}

async function _flushPreferences(deviceIdOverride?: string): Promise<void> {
	if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
	const deviceId = _pendingDeviceId ?? deviceIdOverride ?? null;
	const resolvers = _pendingResolvers;
	_pendingResolvers = [];
	if (!deviceId) {
		resolvers.forEach(r => r(null));
		return;
	}
	_pendingDeviceId = deviceId;
	ensurePendingPatchLoaded(deviceId);
	const patch = _pendingPatch;
	if (!hasPatchEntries(patch)) {
		persistPendingPatch(deviceId, {});
		resolvers.forEach(r => r(null));
		return;
	}
	const result = await _sendPreferences(deviceId, patch);
	if (result) {
		_pendingDeviceId = null;
		_pendingPatch = {};
		persistPendingPatch(deviceId, {});
	} else {
		persistPendingPatch(deviceId, patch);
	}
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
			noteCardBannerTitlePosition: normalizeNoteCardBannerTitlePosition((body as any).noteCardBannerTitlePosition),
			activeWorkspaceId: (body as any).activeWorkspaceId ? String((body as any).activeWorkspaceId) : null,
			activeSharedFolder: (body as any).activeSharedFolder ? String((body as any).activeSharedFolder) : null,
			checklistShowCompleted: Boolean((body as any).checklistShowCompleted),
			quickDeleteChecklist: Boolean((body as any).quickDeleteChecklist),
			noteCardClickOpens: legacyNoteCardInteractions,
			noteCardCheckboxInteractions: (body as any).noteCardCheckboxInteractions !== false && legacyNoteCardInteractions,
			noteCardLinkInteractions: (body as any).noteCardLinkInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedInteractions: (body as any).noteCardCompletedInteractions !== false && legacyNoteCardInteractions,
			noteCardCompletedExpandedByNoteId: safeJson((body as any).noteCardCompletedExpandedByNoteId),
			collapsedRichHeadingIds: safeJson((body as any).collapsedRichHeadingIds),
			bubbleWorkspaceColors: safeJsonStringRecord((body as any).bubbleWorkspaceColors),
			noteColorsByNoteId: safeJsonNullableStringRecord((body as any).noteColorsByNoteId),
			noteBannersByNoteId: safeJsonNullableStringRecord((body as any).noteBannersByNoteId),
			notePinsByDocId: safeStrictBooleanRecord((body as any).notePinsByDocId),
			dismissedFailedLinkIds: safeJson((body as any).dismissedFailedLinkIds),
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
export function flushUserPreferences(deviceId?: string): Promise<void> {
	return _flushPreferences(deviceId);
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
		ensurePendingPatchLoaded(deviceId);
		_pendingPatch = mergePreferencePatches(_pendingPatch, patch);
		persistPendingPatch(deviceId, _pendingPatch);
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
