import * as Y from 'yjs';
import { DocumentManager } from './core/DocumentManager';

function logHeader(title: string): void {
	// eslint-disable-next-line no-console
	console.log(`\n=== ${title} ===`);
}

function snapshot(doc: Y.Doc): {
	title: string;
	content: string;
	checklistLength: number;
} {
	const title = doc.getText('title').toString();
	const content = doc.getText('content').toString();
	const checklistLength = doc.getArray<Y.Map<any>>('checklist').length;
	return { title, content, checklistLength };
}

function isEmpty(doc: Y.Doc): boolean {
	const title = doc.getText('title');
	const content = doc.getText('content');
	const checklist = doc.getArray<Y.Map<any>>('checklist');

	return title.length === 0 && content.length === 0 && checklist.length === 0;
}

function main(): void {
	if (typeof (globalThis as any).indexedDB === 'undefined') {
		// eslint-disable-next-line no-console
		console.error(
			'IndexedDB is not available in this runtime. ' +
				'Run this test in a browser/Electron environment, or add a Node IndexedDB polyfill.'
		);
		process.exitCode = 1;
		return;
	}

	const manager = new DocumentManager();
	const noteId = 'note-1';

	logHeader('Create + Mutate');
	const doc1 = manager.getDoc(noteId);

	const title1 = doc1.getText('title');
	title1.insert(0, 'My First Note');

	const content1 = doc1.getText('content');
	content1.insert(0, 'This is some content.');

	const checklist1 = doc1.getArray<Y.Map<any>>('checklist');
	const item1 = new Y.Map<any>();
	item1.set('id', 'item-1');
	item1.set('text', 'Buy milk');
	item1.set('completed', false);
	checklist1.push([item1]);

	const snap1 = snapshot(doc1);
	// eslint-disable-next-line no-console
	console.log('title:', JSON.stringify(snap1.title));
	// eslint-disable-next-line no-console
	console.log('content:', JSON.stringify(snap1.content));
	// eslint-disable-next-line no-console
	console.log('checklist length:', snap1.checklistLength);

	logHeader('Destroy');
	manager.destroyDoc(noteId);
	// eslint-disable-next-line no-console
	console.log('hasDoc after destroy:', manager.hasDoc(noteId));

	logHeader('Recreate + Verify Empty');
	const doc2 = manager.getDoc(noteId);
	const snap2 = snapshot(doc2);
	// eslint-disable-next-line no-console
	console.log('isEmpty:', isEmpty(doc2));
	// eslint-disable-next-line no-console
	console.log('title:', JSON.stringify(snap2.title));
	// eslint-disable-next-line no-console
	console.log('content:', JSON.stringify(snap2.content));
	// eslint-disable-next-line no-console
	console.log('checklist length:', snap2.checklistLength);
}

main();

