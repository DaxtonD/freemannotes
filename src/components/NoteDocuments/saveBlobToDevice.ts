/** Hands a file to the browser's download, with a name. Shared by the documents list and the PDF viewer. */
export function saveBlobToDevice(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName || 'document';
	anchor.rel = 'noopener';
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	// Some mobile browsers start reading the blob after click() returns. Give them a
	// generous head start before pulling the URL out from under them.
	window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
