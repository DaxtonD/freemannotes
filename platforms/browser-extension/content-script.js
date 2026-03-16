function getSelectionPayload() {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const container = document.createElement('div');
	container.appendChild(range.cloneContents());
	return {
		text: selection.toString(),
		html: container.innerHTML,
	};
}

async function writeClipboard(payload) {
	if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
		const item = {
			'text/plain': new Blob([payload.text], { type: 'text/plain' }),
		};
		if (payload.html) {
			item['text/html'] = new Blob([payload.html], { type: 'text/html' });
		}
		await navigator.clipboard.write([new ClipboardItem(item)]);
		return { ok: true };
	}

	const onCopy = (event) => {
		event.preventDefault();
		event.clipboardData?.setData('text/plain', payload.text);
		if (payload.html) {
			event.clipboardData?.setData('text/html', payload.html);
		}
	};
	document.addEventListener('copy', onCopy, { capture: true, once: true });
	document.execCommand('copy');
	return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
	if (message?.type === 'freemannotes:get-selection') {
		sendResponse(getSelectionPayload());
		return true;
	}
	if (message?.type === 'freemannotes:write-clipboard') {
		void writeClipboard(message.payload).then(sendResponse);
		return true;
	}
	return false;
});
