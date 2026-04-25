import { logClientEvent } from './debugLogger';

type TimedFetchInit = RequestInit & {
	timeoutMs?: number;
	requestName?: string;
};

// Normalize RequestInfo into a stable string for logging regardless of whether
// callers pass a URL object, Request instance, or raw string.
function resolveRequestUrl(input: RequestInfo | URL): string {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.toString();
	if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
	return String(input);
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: TimedFetchInit = {}): Promise<Response> {
	const timeoutMs = Math.max(0, Number(init.timeoutMs ?? 1500) || 0);
	const requestName = String(init.requestName || '').trim() || resolveRequestUrl(input);
	const startedAt = Date.now();
	const controller = new AbortController();
	let timeoutId: number | null = null;
	let abortedByTimeout = false;
	// Preserve upstream abort semantics while still layering our own timeout-based
	// cancellation on top of the same request.
	const onAbort = (): void => controller.abort();
	if (init.signal) {
		if (init.signal.aborted) controller.abort();
		else init.signal.addEventListener('abort', onAbort, { once: true });
	}
	void logClientEvent('NETWORK_REQUEST_START', { requestName, url: resolveRequestUrl(input), timeoutMs });
	try {
		if (timeoutMs > 0 && typeof window !== 'undefined') {
			timeoutId = window.setTimeout(() => {
				abortedByTimeout = true;
				controller.abort();
			}, timeoutMs);
		}
		const response = await fetch(input, {
			...init,
			signal: controller.signal,
		});
		void logClientEvent('NETWORK_REQUEST_SUCCESS', {
			requestName,
			url: resolveRequestUrl(input),
			status: response.status,
			latencyMs: Date.now() - startedAt,
		});
		return response;
	} catch (error) {
		if (abortedByTimeout) {
			void logClientEvent('NETWORK_REQUEST_TIMEOUT', {
				requestName,
				url: resolveRequestUrl(input),
				timeoutMs,
				latencyMs: Date.now() - startedAt,
			});
		}
		throw error;
	} finally {
		if (timeoutId !== null && typeof window !== 'undefined') {
			window.clearTimeout(timeoutId);
		}
		if (init.signal) {
			init.signal.removeEventListener('abort', onAbort);
		}
	}
}

export async function fetchJsonWithTimeout<T>(input: RequestInfo | URL, init: TimedFetchInit = {}): Promise<T> {
	// Centralize JSON error parsing so API helpers can share the same timeout and
	// error-message behavior without repeating boilerplate.
	const response = await fetchWithTimeout(input, init);
	const contentType = String(response.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
	if (!response.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
		throw new Error(message);
	}
	return body as T;
}