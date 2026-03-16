import {
	convertToMarkdown,
	convertToRichText,
	detectClipboardSourceFormat,
	prepareConvertedClipboardPayload,
} from '../../src/core/clipboardConversion';

const api = {
	convertToMarkdown,
	convertToRichText,
	detectClipboardSourceFormat,
	prepareConvertedClipboardPayload,
};

(globalThis as typeof globalThis & { FreemanClipboardConverter?: typeof api }).FreemanClipboardConverter = api;

export default api;
