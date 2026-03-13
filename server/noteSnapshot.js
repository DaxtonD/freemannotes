'use strict';

const Y = require('yjs');

function normalizeText(value) {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

function materializeChecklist(doc) {
	return doc.getArray('checklist').toArray().map((item) => ({
		id: String(item.get('id') || ''),
		text: normalizeText(item.get('text')),
		completed: Boolean(item.get('completed')),
		parentId: typeof item.get('parentId') === 'string' ? String(item.get('parentId')).trim() || null : null,
	})).filter((item) => item.id.length > 0);
}

function joinChecklistText(items) {
	return items.map((item) => item.text).filter(Boolean).join(' ');
}

function decodeDocumentState(state) {
	const tempDoc = new Y.Doc();
	Y.applyUpdate(tempDoc, new Uint8Array(state));
	const metadata = tempDoc.getMap('metadata').toJSON();
	const title = tempDoc.getText('title').toString();
	const content = tempDoc.getText('content').toString();
	const checklist = materializeChecklist(tempDoc);
	const type = metadata && metadata.type === 'checklist' ? 'checklist' : 'text';
	const plainText = normalizeText(`${title} ${type === 'checklist' ? joinChecklistText(checklist) : content}`);
	tempDoc.destroy();
	return {
		title,
		content,
		checklist,
		metadata,
		type,
		plainText,
		trashed: Boolean(metadata && metadata.trashed),
		archived: Boolean(metadata && metadata.archived),
	};
}

function buildSearchSnippet(haystack, query) {
	const normalizedHaystack = normalizeText(haystack);
	const normalizedQuery = normalizeText(query).toLowerCase();
	if (!normalizedHaystack) return '';
	if (!normalizedQuery) return normalizedHaystack.slice(0, 180);
	const lowerHaystack = normalizedHaystack.toLowerCase();
	const idx = lowerHaystack.indexOf(normalizedQuery);
	if (idx === -1) return normalizedHaystack.slice(0, 180);
	const start = Math.max(0, idx - 48);
	const end = Math.min(normalizedHaystack.length, idx + normalizedQuery.length + 96);
	const prefix = start > 0 ? '... ' : '';
	const suffix = end < normalizedHaystack.length ? ' ...' : '';
	return `${prefix}${normalizedHaystack.slice(start, end)}${suffix}`;
}

module.exports = {
	buildSearchSnippet,
	decodeDocumentState,
	normalizeText,
};