import * as Y from 'yjs';
import type { DocumentManager } from './DocumentManager';

export type ChecklistItem = {
	id: string;
	text: string;
	completed: boolean;
};

declare global {
	interface Window {
		DEBUG?: boolean;
		manager?: DocumentManager;
		doc?: Y.Doc;
		titleYText?: Y.Text;
		contentYText?: Y.Text;
		checklist?: DebugChecklist;
		cleanupDebugBindings?: () => void;
	}
}

function shouldDebugLog(): boolean {
	return typeof window !== 'undefined' && Boolean(window.DEBUG);
}

function summarizeText(text: string): { length: number; preview: string } {
	const preview = text.length <= 160 ? text : `${text.slice(0, 160)}…`;
	return { length: text.length, preview };
}

function textSignature(text: string): string {
	const head = text.slice(0, 64);
	const tail = text.length > 64 ? text.slice(text.length - 64) : '';
	return `${text.length}\u0000${head}\u0000${tail}`;
}

function checklistSignature(items: readonly ChecklistItem[]): string {
	return items.map(it => `${it.id}\u0000${it.completed ? '1' : '0'}\u0000${it.text}`).join('\n');
}

function readChecklistItems(yarray: Y.Array<Y.Map<any>>): ChecklistItem[] {
	return yarray.toArray().map(m => ({
		id: String(m.get('id') ?? ''),
		text: String(m.get('text') ?? ''),
		completed: Boolean(m.get('completed'))
	})).filter(it => it.id.trim().length > 0);
}

export class DebugChecklist {
	private readonly yarray: Y.Array<Y.Map<any>>;
	private readonly origin: symbol;

	constructor(yarray: Y.Array<Y.Map<any>>, origin?: symbol) {
		this.yarray = yarray;
		this.origin = origin ?? Symbol('DebugChecklist');
	}

	getItems(): readonly ChecklistItem[] {
		return readChecklistItems(this.yarray);
	}

	add(item: { id: string; text: string; completed: boolean }): void {
		const id = String(item.id ?? '').trim();
		if (!id) throw new TypeError('checklist.add: item.id must be non-empty');
		this.transact(() => {
			const m = new Y.Map<any>();
			m.set('id', id);
			m.set('text', String(item.text ?? ''));
			m.set('completed', Boolean(item.completed));
			this.yarray.push([m]);
		});
	}

	remove(index: number): void {
		const idx = this.normalizeIndex(index);
		if (idx === null) return;
		this.transact(() => this.yarray.delete(idx, 1));
	}

	update(index: number, partial: Partial<{ id: string; text: string; completed: boolean }>): void {
		const idx = this.normalizeIndex(index);
		if (idx === null) return;
		this.transact(() => {
			const m = this.yarray.get(idx);
			if (!m) return;
			if (partial.id !== undefined) m.set('id', String(partial.id).trim());
			if (partial.text !== undefined) m.set('text', String(partial.text));
			if (partial.completed !== undefined) m.set('completed', Boolean(partial.completed));
		});
	}

	private transact(fn: () => void): void {
		const doc = (this.yarray as any).doc as Y.Doc | undefined | null;
		if (doc) doc.transact(fn, this.origin);
		else fn();
	}

	private normalizeIndex(index: number): number | null {
		if (!Number.isInteger(index)) throw new TypeError('checklist index must be an integer');
		return index < 0 || index >= this.yarray.length ? null : index;
	}
}

export function installDebugGlobals(args: { manager: DocumentManager; noteId: string; doc: Y.Doc }): () => void {
	const { manager, noteId, doc } = args;

	const titleYText = doc.getText('title');
	const contentYText = doc.getText('content');
	const checklistArray = doc.getArray<Y.Map<any>>('checklist');

	// Expose globals
	window.manager = manager;
	window.doc = doc;
	window.titleYText = titleYText;
	window.contentYText = contentYText;
	window.checklist = new DebugChecklist(checklistArray);

	let destroyed = false;
	let debounceTimer: number | null = null;

	let lastTitle = titleYText.toString();
	let lastContentSig = textSignature(contentYText.toString());
	let lastChecklistSig = checklistSignature(readChecklistItems(checklistArray));

	const flush = (): void => {
		debounceTimer = null;
		if (destroyed || !shouldDebugLog()) return;

		const update: Record<string, unknown> = {};

		const newTitle = titleYText.toString();
		if (newTitle !== lastTitle) {
			lastTitle = newTitle;
			update.title = newTitle;
		}

		const newContent = contentYText.toString();
		const newContentSig = textSignature(newContent);
		if (newContentSig !== lastContentSig) {
			lastContentSig = newContentSig;
			update.content = summarizeText(newContent);
		}

		const items = readChecklistItems(checklistArray);
		const newChecklistSig = checklistSignature(items);
		if (newChecklistSig !== lastChecklistSig) {
			lastChecklistSig = newChecklistSig;
			update.checklist = { count: items.length, items };
		}

		if (Object.keys(update).length > 0) {
			console.log(`[CRDT] [${noteId}] update`, update);
		}
	};

	const scheduleFlush = (): void => {
		if (destroyed || debounceTimer !== null || !shouldDebugLog()) return;
		debounceTimer = window.setTimeout(flush, 150);
	};

	// Attach observers **after initial log** to avoid initialization storms
	const initialLog = (): void => {
		if (!shouldDebugLog()) return;

		console.log(`[CRDT] [${noteId}] initial`, {
			title: titleYText.toString(),
			content: summarizeText(contentYText.toString()),
			checklist: { count: checklistArray.length, items: readChecklistItems(checklistArray) }
		});
	};

	initialLog();

	const onTitle = (): void => { scheduleFlush(); };
	const onContent = (): void => { scheduleFlush(); };
	const onChecklist = (): void => { scheduleFlush(); };

	titleYText.observe(onTitle);
	contentYText.observe(onContent);
	checklistArray.observeDeep(onChecklist);

	const cleanup = (): void => {
		if (destroyed) return;
		destroyed = true;
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		titleYText.unobserve(onTitle);
		contentYText.unobserve(onContent);
		checklistArray.unobserveDeep(onChecklist);

		if (window.cleanupDebugBindings === cleanup) delete window.cleanupDebugBindings;
	};

	window.cleanupDebugBindings = cleanup;
	return cleanup;
}
