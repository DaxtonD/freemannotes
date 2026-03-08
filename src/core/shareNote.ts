function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export async function createDocShareUrl(docId: string): Promise<string> {
	const normalizedId = normalizeId(docId);
	if (!normalizedId) throw new Error('Missing docId');

	const res = await fetch(`/api/docs/${encodeURIComponent(normalizedId)}/share`, {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) {
		const msg = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(msg);
	}
	const shareUrl = body && typeof body.shareUrl === 'string' ? body.shareUrl : '';
	if (!shareUrl) throw new Error('Missing shareUrl');
	return shareUrl;
}

export async function shareDocById(docId: string, opts?: { title?: string }): Promise<void> {
	try {
		const shareUrl = await createDocShareUrl(docId);
		const title = typeof opts?.title === 'string' && opts.title.trim().length > 0 ? opts.title.trim() : undefined;

		if (typeof navigator !== 'undefined' && 'share' in navigator && typeof (navigator as any).share === 'function') {
			try {
				await (navigator as any).share({ title, url: shareUrl });
				return;
			} catch {
				// Fall back to clipboard if share sheet is unavailable or cancelled.
			}
		}

		if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
			try {
				await navigator.clipboard.writeText(shareUrl);
				return;
			} catch {
				// Fall back to opening the URL.
			}
		}

		if (typeof window !== 'undefined' && typeof window.open === 'function') {
			window.open(shareUrl, '_blank', 'noopener,noreferrer');
		}
	} catch (err) {
		console.warn('[share] failed:', err instanceof Error ? err.message : err);
	}
}
