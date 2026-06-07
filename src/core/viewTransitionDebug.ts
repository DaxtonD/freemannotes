import { isDebugLoggingEnabled, logClientEvent } from './debugLogger';

const VIEW_TRANSITION_EVENT_BUFFER_LIMIT = 300;
const VIEW_TRANSITION_LOCAL_TRACE_STORAGE_KEY = 'freemannotes.viewTransitionTrace';

export type ViewTransitionTraceEvent = {
	traceId: string;
	phase: string;
	timestamp: number;
	data: Record<string, unknown>;
};

type ViewTransitionDebugWindow = Window & {
	__fnViewTransitionEvents?: ViewTransitionTraceEvent[];
	__fnLastViewTransitionTraceId?: string | null;
	__fnPrintViewTransitionTrace?: (traceId?: string | null) => ViewTransitionTraceEvent[];
	__fnEnableViewTransitionTrace?: (enabled?: boolean) => boolean;
};

function parseDebugToggle(value: unknown): boolean | null {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
	if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
	return null;
}

function makeRandomId(prefix: string): string {
	try {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return `${prefix}-${crypto.randomUUID()}`;
		}
	} catch {
		// ignore
	}
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDebugWindow(): ViewTransitionDebugWindow | null {
	if (typeof window === 'undefined') return null;
	return window as ViewTransitionDebugWindow;
}

function installDebugWindowHelpers(): void {
	const debugWindow = getDebugWindow();
	if (!debugWindow) return;
	if (typeof debugWindow.__fnPrintViewTransitionTrace !== 'function') {
		debugWindow.__fnPrintViewTransitionTrace = (traceId?: string | null): ViewTransitionTraceEvent[] => {
			const events = debugWindow.__fnViewTransitionEvents ?? [];
			const resolvedTraceId = typeof traceId === 'string' && traceId.trim().length > 0
				? traceId.trim()
				: debugWindow.__fnLastViewTransitionTraceId ?? null;
			const filtered = resolvedTraceId
				? events.filter((event) => event.traceId === resolvedTraceId)
				: events.slice();
			console.table(filtered.map((event) => ({
				traceId: event.traceId,
				phase: event.phase,
				timestamp: new Date(event.timestamp).toISOString(),
				...event.data,
			})));
			return filtered;
		};
	}
	if (typeof debugWindow.__fnEnableViewTransitionTrace !== 'function') {
		debugWindow.__fnEnableViewTransitionTrace = (enabled = true): boolean => {
			try {
				window.localStorage.setItem(VIEW_TRANSITION_LOCAL_TRACE_STORAGE_KEY, enabled ? '1' : '0');
			} catch {
				// Best effort only.
			}
			return enabled;
		};
	}
}

function isLocalTraceEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	const isDevBuild = Boolean((import.meta as any).env?.DEV);
	try {
		const url = new URL(window.location.href);
		const queryFlag = parseDebugToggle(
			url.searchParams.get('viewTransitionTrace')
			?? url.searchParams.get('traceView')
			?? url.searchParams.get('debugViewTransition')
		);
		if (queryFlag !== null) {
			window.localStorage.setItem(VIEW_TRANSITION_LOCAL_TRACE_STORAGE_KEY, queryFlag ? '1' : '0');
			return queryFlag;
		}
	} catch {
		// ignore malformed location state
	}
	try {
		const stored = parseDebugToggle(window.localStorage.getItem(VIEW_TRANSITION_LOCAL_TRACE_STORAGE_KEY));
		if (stored !== null) return stored;
	} catch {
		// ignore localStorage failures
	}
	return isDevBuild;
}

export function isViewTransitionDebugEnabled(): boolean {
	return isLocalTraceEnabled() || isDebugLoggingEnabled();
}

export function createViewTransitionTraceId(kind: string, from: string | null | undefined, to: string | null | undefined): string {
	const normalizedKind = String(kind || 'view').trim() || 'view';
	const normalizedFrom = String(from || 'unknown').trim() || 'unknown';
	const normalizedTo = String(to || 'unknown').trim() || 'unknown';
	return `${normalizedKind}:${normalizedFrom}->${normalizedTo}:${makeRandomId('trace')}`;
}

export function recordViewTransitionTrace(traceId: string | null | undefined, phase: string, data: Record<string, unknown> = {}): void {
	if (!traceId || !isViewTransitionDebugEnabled()) return;
	const event: ViewTransitionTraceEvent = {
		traceId,
		phase,
		timestamp: Date.now(),
		data,
	};
	const debugWindow = getDebugWindow();
	if (debugWindow) {
		installDebugWindowHelpers();
		const nextEvents = [...(debugWindow.__fnViewTransitionEvents ?? []), event].slice(-VIEW_TRANSITION_EVENT_BUFFER_LIMIT);
		debugWindow.__fnViewTransitionEvents = nextEvents;
		debugWindow.__fnLastViewTransitionTraceId = traceId;
		console.debug('[view-transition-trace]', phase, { traceId, ...data });
	}
	if (!isDebugLoggingEnabled()) return;
	void logClientEvent('VIEW_TRANSITION_TRACE', {
		traceId,
		phase,
		...data,
	});
}

installDebugWindowHelpers();