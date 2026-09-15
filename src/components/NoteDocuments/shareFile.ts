// Sharing a file straight to another app (email, WhatsApp, Teams, Drive…) through the device's own
// share sheet: the Web Share API with files. Android Chrome, iOS Safari and Chrome/Edge on Windows
// support it; Firefox on the desktop doesn't, and nothing does over plain http. Browsers also only
// allow some file types (PDFs everywhere; Office files not always), so support is checked per file.

export type ShareOutcome = 'shared' | 'cancelled' | 'needs-tap' | 'unsupported' | 'failed';

function hasFileShare(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
}

/** Whether this browser can hand a file of this name and type to the share sheet. */
export function canShareFileType(fileName: string, mimeType: string): boolean {
	if (!hasFileShare()) return false;
	try {
		const probe = new File([new Uint8Array([0])], fileName || 'file', { type: mimeType || 'application/octet-stream' });
		return navigator.canShare({ files: [probe] });
	} catch {
		return false;
	}
}

/**
 * Opens the share sheet with the file. Must run straight from a tap: browsers refuse a share once
 * the tap's user activation has worn off (building a big marked-up PDF can take that long), which
 * comes back as 'needs-tap' so the caller can ask for one more tap.
 */
export async function shareFile(blob: Blob, fileName: string): Promise<ShareOutcome> {
	if (!hasFileShare()) return 'unsupported';
	const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
	try {
		if (!navigator.canShare({ files: [file] })) return 'unsupported';
		// Only the file: some apps (WhatsApp among them) send a title or text as a separate message.
		await navigator.share({ files: [file] });
		return 'shared';
	} catch (error) {
		const name = (error as { name?: string } | null)?.name;
		if (name === 'AbortError') return 'cancelled';
		if (name === 'NotAllowedError') return 'needs-tap';
		console.error('[share] sharing the file failed', error);
		return 'failed';
	}
}
