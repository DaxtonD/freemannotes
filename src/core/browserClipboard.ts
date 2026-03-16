import type { ClipboardPayload } from './clipboardConversion';

function execCommandCopy(payload: ClipboardPayload): boolean {
	if (typeof document === 'undefined') return false;
	let copied = false;
	const onCopy = (event: ClipboardEvent): void => {
		event.preventDefault();
		event.clipboardData?.setData('text/plain', payload.text);
		if (payload.html) {
			event.clipboardData?.setData('text/html', payload.html);
		}
		copied = true;
	};
	document.addEventListener('copy', onCopy, { capture: true, once: true });
	try {
		document.execCommand('copy');
	} finally {
		document.removeEventListener('copy', onCopy, true);
	}
	return copied;
}

export async function writeClipboardPayload(payload: ClipboardPayload): Promise<void> {
	if (!payload.text && !payload.html) {
		throw new Error('Nothing to copy');
	}

	if (
		typeof navigator !== 'undefined' &&
		navigator.clipboard &&
		typeof navigator.clipboard.write === 'function' &&
		typeof ClipboardItem !== 'undefined'
	) {
		const itemData: Record<string, Blob> = {
			'text/plain': new Blob([payload.text], { type: 'text/plain' }),
		};
		if (payload.html) {
			itemData['text/html'] = new Blob([payload.html], { type: 'text/html' });
		}
		await navigator.clipboard.write([new ClipboardItem(itemData)]);
		return;
	}

	if (execCommandCopy(payload)) return;

	if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
		await navigator.clipboard.writeText(payload.text);
		return;
	}

	throw new Error('Clipboard unavailable');
}