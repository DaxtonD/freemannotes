// Bundle `platforms/shared/clipboard-converter-global.ts` for the extension and
// update this import to point at the generated JavaScript artifact.
import converter from '../shared/clipboard-converter-global.js';

const MENU_COPY_MARKDOWN = 'freemannotes-copy-markdown';
const MENU_COPY_RICH_TEXT = 'freemannotes-copy-rich-text';

chrome.runtime.onInstalled.addListener(() => {
	chrome.contextMenus.create({
		id: MENU_COPY_MARKDOWN,
		title: 'Copy Markdown',
		contexts: ['selection'],
	});
	chrome.contextMenus.create({
		id: MENU_COPY_RICH_TEXT,
		title: 'Copy Rich Text',
		contexts: ['selection'],
	});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
	if (!tab?.id) return;
	if (info.menuItemId !== MENU_COPY_MARKDOWN && info.menuItemId !== MENU_COPY_RICH_TEXT) return;
	const target = info.menuItemId === MENU_COPY_MARKDOWN ? 'markdown' : 'rich-text';
	const selection = await chrome.tabs.sendMessage(tab.id, { type: 'freemannotes:get-selection' });
	if (!selection?.text) return;
	const payload = converter.prepareConvertedClipboardPayload(selection, target);
	await chrome.tabs.sendMessage(tab.id, {
		type: 'freemannotes:write-clipboard',
		payload,
	});
});
