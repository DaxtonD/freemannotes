export function resizeAutoHeightTextarea(node: HTMLTextAreaElement | null): void {
	if (!node) return;
	// Reset first so shrinking text can reduce the field height as well.
	node.style.height = '0px';
	node.style.height = `${node.scrollHeight}px`;
}