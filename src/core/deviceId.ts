const STORAGE_KEY = 'freemannotes.deviceId';

function makeDeviceId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceId(): string {
	if (typeof window === 'undefined') return 'legacy';
	try {
		const existing = String(window.localStorage.getItem(STORAGE_KEY) || '').trim();
		if (existing) return existing;
		const next = makeDeviceId();
		window.localStorage.setItem(STORAGE_KEY, next);
		return next;
	} catch {
		return 'legacy';
	}
}
