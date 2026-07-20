// Offline avatar upload queue.
//
// When the user saves a new avatar while offline (or before the upload
// response arrives), the cropped image is stored as a data: URL directly in
// the auth cache's `profileImage` field.  A `data:` prefix is the signal
// that a sync is still pending; `/uploads/` means the server confirmed it.
//
// `attemptPendingAvatarUpload` is called:
//  - immediately after the optimistic update (fire-and-forget, usually online)
//  - from the `online` event handler so it retries when connectivity returns
//  - from any other restore path that already has connectivity

const AUTH_CACHE_KEY = 'freemannotes.auth.cache.v1';

function readPendingDataUrl(userId: string): string | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = window.localStorage.getItem(AUTH_CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown> | null;
		if (!parsed || parsed['v'] !== 1 || parsed['userId'] !== userId) return null;
		const pi = parsed['profileImage'];
		return typeof pi === 'string' && pi.startsWith('data:') ? pi : null;
	} catch {
		return null;
	}
}

/**
 * Attempts to flush a pending avatar upload stored as a data: URL in the auth
 * cache.  Returns the server-side `/uploads/…` URL on success, or `null` when
 * there is no pending upload, the device is offline, or the upload request
 * fails (the data: URL stays in the auth cache so the next `online` event can
 * retry automatically).
 *
 * Callers are responsible for updating React state and the auth cache with the
 * returned server URL.
 */
export async function attemptPendingAvatarUpload(userId: string): Promise<string | null> {
	const dataUrl = readPendingDataUrl(userId);
	if (!dataUrl) return null;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

	try {
		// `fetch` supports data: URLs natively — no FileReader needed.
		const blob = await fetch(dataUrl).then((r) => r.blob());
		const form = new FormData();
		form.append('file', blob, 'avatar.png');

		const res = await fetch('/api/user/profile-image', {
			method: 'POST',
			credentials: 'include',
			body: form,
		});
		if (!res.ok) return null;

		const body = await res.json().catch(() => null) as { profileImage?: unknown } | null;
		const serverUrl = typeof body?.profileImage === 'string' && body.profileImage ? body.profileImage : null;
		return serverUrl;
	} catch {
		// Network error or offline — keep the pending data: URL for the next retry.
		return null;
	}
}
