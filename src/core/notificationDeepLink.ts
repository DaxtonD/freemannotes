export type NotificationDeepLink = {
	workspaceId: string;
	noteId: string;
};

export const NOTIFICATION_DEEP_LINK_STASHED_EVENT = 'freemannotes:notification-deep-link-stashed';

const PENDING_DEEP_LINK_KEY = 'freemannotes:pending-notification-deep-link';

function normalizeDeepLink(workspaceId: unknown, noteId: unknown): NotificationDeepLink | null {
	const normalizedWorkspaceId = String(workspaceId || '').trim();
	const normalizedNoteId = String(noteId || '').trim();
	if (!normalizedWorkspaceId || !normalizedNoteId) return null;
	return { workspaceId: normalizedWorkspaceId, noteId: normalizedNoteId };
}

export function parseDocIdDeepLink(docId: unknown): NotificationDeepLink | null {
	const normalizedDocId = String(docId || '').trim();
	if (!normalizedDocId) return null;
	const separatorIndex = normalizedDocId.indexOf(':');
	if (separatorIndex <= 0 || separatorIndex >= normalizedDocId.length - 1) return null;
	return normalizeDeepLink(
		normalizedDocId.slice(0, separatorIndex),
		normalizedDocId.slice(separatorIndex + 1),
	);
}

export function readNotificationDeepLinkFromUrl(href?: string): NotificationDeepLink | null {
	if (typeof window === 'undefined' && !href) return null;
	try {
		const url = new URL(href || window.location.href);
		const direct = normalizeDeepLink(url.searchParams.get('workspace'), url.searchParams.get('note'));
		if (direct) return direct;
		return parseDocIdDeepLink(url.searchParams.get('doc'));
	} catch {
		return null;
	}
}

export function stashNotificationDeepLink(link: NotificationDeepLink): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(PENDING_DEEP_LINK_KEY, JSON.stringify(link));
	} catch {
		// ignore
	}
	window.dispatchEvent(new CustomEvent(NOTIFICATION_DEEP_LINK_STASHED_EVENT));
}

export function readStashedNotificationDeepLink(): NotificationDeepLink | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { workspaceId?: unknown; noteId?: unknown };
		return normalizeDeepLink(parsed.workspaceId, parsed.noteId);
	} catch {
		return null;
	}
}

export function captureNotificationDeepLink(): NotificationDeepLink | null {
	return readNotificationDeepLinkFromUrl() ?? readStashedNotificationDeepLink();
}

const CONSUMED_DEEP_LINK_KEY = 'freemannotes:consumed-notification-deep-link';

function deepLinkIdentity(link: NotificationDeepLink): string {
	return `${link.workspaceId}:${link.noteId}`;
}

export function markNotificationDeepLinkConsumed(link: NotificationDeepLink): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.setItem(CONSUMED_DEEP_LINK_KEY, deepLinkIdentity(link));
	} catch {
		// ignore
	}
}

export function isNotificationDeepLinkConsumed(link: NotificationDeepLink): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return sessionStorage.getItem(CONSUMED_DEEP_LINK_KEY) === deepLinkIdentity(link);
	} catch {
		return false;
	}
}

export function clearConsumedNotificationDeepLink(): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.removeItem(CONSUMED_DEEP_LINK_KEY);
	} catch {
		// ignore
	}
}

export function clearNotificationDeepLinkFromUrl(): void {
	if (typeof window === 'undefined') return;
	try {
		const url = new URL(window.location.href);
		if (!url.searchParams.has('workspace') && !url.searchParams.has('note') && !url.searchParams.has('doc')) return;
		url.searchParams.delete('workspace');
		url.searchParams.delete('note');
		url.searchParams.delete('doc');
		const next = `${url.pathname}${url.search}${url.hash}`;
		window.history.replaceState(window.history.state, '', next);
	} catch {
		// ignore
	}
}

export function clearPendingNotificationDeepLink(): void {
	if (typeof window === 'undefined') return;
	try {
		sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
	} catch {
		// ignore
	}
	clearNotificationDeepLinkFromUrl();
}

export function parseNotificationDeepLinkMessage(data: unknown): NotificationDeepLink | null {
	if (!data || typeof data !== 'object') return null;
	const payload = data as {
		workspaceId?: unknown;
		noteId?: unknown;
		docId?: unknown;
		url?: unknown;
	};
	const direct = normalizeDeepLink(payload.workspaceId, payload.noteId);
	if (direct) return direct;
	const fromDocId = parseDocIdDeepLink(payload.docId);
	if (fromDocId) return fromDocId;
	if (typeof payload.url === 'string' && payload.url.trim()) {
		try {
			return readNotificationDeepLinkFromUrl(new URL(payload.url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').href);
		} catch {
			return readNotificationDeepLinkFromUrl(payload.url);
		}
	}
	return null;
}
