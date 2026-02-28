import * as Y from 'yjs';

export type TextChangeSource = 'editor' | 'yjs';

export interface TextLikeEditor {
	getText(): string;
	setText(next: string, source: TextChangeSource): void;
	onChange(handler: (next: string, source: TextChangeSource) => void): () => void;
}

// Minimal headless editor abstraction used to bridge Yjs text with React inputs.
export class HeadlessTextEditor implements TextLikeEditor {
	private text = '';
	private readonly handlers = new Set<(next: string, source: TextChangeSource) => void>();

	public getText(): string {
		return this.text;
	}

	public setText(next: string, source: TextChangeSource): void {
		this.text = next;
		for (const handler of this.handlers) {
			handler(next, source);
		}
	}

	public onChange(handler: (next: string, source: TextChangeSource) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	public appendLocal(suffix: string): void {
		this.setText(this.text + suffix, 'editor');
	}
}

export type TextBindingChange = {
	value: string;
	source: TextChangeSource | 'init';
};

// Two-way binding between a Y.Text and a TextLikeEditor.
// Source tagging prevents local echo loops.
export class TextBinding {
	private readonly ytext: Y.Text;
	private readonly editor: TextLikeEditor;
	private readonly onUpdate: (change: TextBindingChange) => void;
	private readonly origin: symbol;
	private readonly unsubs: Array<() => void> = [];
	private destroyed = false;

	public constructor(args: {
		ytext: Y.Text;
		editor: TextLikeEditor;
		onUpdate: (change: TextBindingChange) => void;
		origin?: symbol;
	}) {
		this.ytext = args.ytext;
		this.editor = args.editor;
		this.onUpdate = args.onUpdate;
		this.origin = args.origin ?? Symbol('TextBinding');

		// Initialize editor from Yjs.
		const initial = this.ytext.toString();
		this.editor.setText(initial, 'yjs');
		this.onUpdate({ value: initial, source: 'init' });

		// Push local editor edits into Yjs.
		this.unsubs.push(
			this.editor.onChange((next, source) => {
				if (this.destroyed) return;
				if (source !== 'editor') return;

				const prev = this.ytext.toString();
				if (next === prev) return;

				this.transact(() => {
					// Apply a minimal diff (common prefix + suffix) rather than rewriting
					// the entire Y.Text on every keystroke.
					let start = 0;
					const prevLen = prev.length;
					const nextLen = next.length;
					const minLen = prevLen < nextLen ? prevLen : nextLen;
					while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) {
						start++;
					}

					let prevEnd = prevLen - 1;
					let nextEnd = nextLen - 1;
					while (
						prevEnd >= start &&
						nextEnd >= start &&
						prev.charCodeAt(prevEnd) === next.charCodeAt(nextEnd)
					) {
						prevEnd--;
						nextEnd--;
					}

					const deleteLen = prevEnd >= start ? prevEnd - start + 1 : 0;
					const insertText = nextEnd >= start ? next.slice(start, nextEnd + 1) : '';

					if (deleteLen > 0) {
						this.ytext.delete(start, deleteLen);
					}
					if (insertText.length > 0) {
						this.ytext.insert(start, insertText);
					}
				});

				// Safety net: if minimal diff failed for any edge case, fall back to
				// a full replace to guarantee CRDT propagation.
				if (this.ytext.toString() !== next) {
					this.transact(() => {
						this.ytext.delete(0, this.ytext.length);
						if (next.length > 0) {
							this.ytext.insert(0, next);
						}
					});
				}

				this.onUpdate({ value: next, source: 'editor' });
			})
		);

		// Push remote Yjs updates into editor.
		const yObserver = (_event: Y.YTextEvent, transaction: Y.Transaction): void => {
			if (this.destroyed) return;
			if (transaction.origin === this.origin) return;

			const next = this.ytext.toString();
			this.editor.setText(next, 'yjs');
			this.onUpdate({ value: next, source: 'yjs' });
		};

		this.ytext.observe(yObserver);
		this.unsubs.push(() => this.ytext.unobserve(yObserver));
	}

	public destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const unsub of this.unsubs.splice(0)) {
			unsub();
		}
	}

	private transact(fn: () => void): void {
		const doc = (this.ytext as any).doc as Y.Doc | null | undefined;
		if (doc) {
			doc.transact(fn, this.origin);
			return;
		}
		fn();
	}
}

export type ChecklistItem = {
	id: string;
	text: string;
	completed: boolean;
};

export class ChecklistModel {
	private readonly yarray: Y.Array<Y.Map<any>>;
	private readonly origin: symbol;

	public constructor(yarray: Y.Array<Y.Map<any>>, origin?: symbol) {
		this.yarray = yarray;
		this.origin = origin ?? Symbol('ChecklistModel');
	}

	public get length(): number {
		return this.yarray.length;
	}

	public toArray(): ChecklistItem[] {
		// Materialize immutable plain objects for UI rendering.
		return this.yarray
			.toArray()
			.map((m) => ({
				id: String(m.get('id') ?? ''),
				text: String(m.get('text') ?? ''),
				completed: Boolean(m.get('completed')),
			}))
			.filter((item) => item.id.length > 0);
	}

	public addItem(item: ChecklistItem): void {
		this.transact(() => {
			const m = new Y.Map<any>();
			m.set('id', item.id);
			m.set('text', item.text);
			m.set('completed', item.completed);
			this.yarray.push([m]);
		});
	}

	public removeById(id: string): void {
		this.transact(() => {
			const idx = this.findIndexById(id);
			if (idx === -1) return;
			this.yarray.delete(idx, 1);
		});
	}

	public updateById(id: string, patch: Partial<Omit<ChecklistItem, 'id'>>): void {
		this.transact(() => {
			const m = this.findMapById(id);
			if (!m) return;
			if (patch.text !== undefined) m.set('text', patch.text);
			if (patch.completed !== undefined) m.set('completed', patch.completed);
		});
	}

	private transact(fn: () => void): void {
		const doc = (this.yarray as any).doc as Y.Doc | null | undefined;
		if (doc) {
			doc.transact(fn, this.origin);
			return;
		}
		fn();
	}

	private findIndexById(id: string): number {
		const arr = this.yarray.toArray();
		for (let i = 0; i < arr.length; i++) {
			if (String(arr[i].get('id')) === id) return i;
		}
		return -1;
	}

	private findMapById(id: string): Y.Map<any> | undefined {
		for (const m of this.yarray.toArray()) {
			if (String(m.get('id')) === id) return m;
		}
		return undefined;
	}
}

export type ChecklistBindingChange = {
	items: readonly ChecklistItem[];
	source: 'yjs' | 'init';
};

export class ChecklistBinding {
	public readonly model: ChecklistModel;
	private readonly yarray: Y.Array<Y.Map<any>>;
	private readonly onUpdate: (change: ChecklistBindingChange) => void;
	private readonly origin: symbol;
	private readonly listeners = new Set<() => void>();
	private itemsCache: readonly ChecklistItem[] = [];
	private destroyed = false;
	private readonly unsubs: Array<() => void> = [];

	public constructor(args: {
		yarray: Y.Array<Y.Map<any>>;
		onUpdate: (change: ChecklistBindingChange) => void;
		origin?: symbol;
	}) {
		this.yarray = args.yarray;
		this.onUpdate = args.onUpdate;
		this.origin = args.origin ?? Symbol('ChecklistBinding');
		this.model = new ChecklistModel(args.yarray, args.origin);

		const initial = this.model.toArray();
		this.itemsCache = initial;
		this.onUpdate({ items: initial, source: 'init' });
		this.emit();

		// observeDeep catches inserts/deletes/field updates inside the checklist item maps.
		const deepObserver = (_events: Array<Y.YEvent<any>>, transaction: Y.Transaction): void => {
			if (this.destroyed) return;
			// Avoid double notifications for local changes that already notified synchronously.
			if (transaction.origin === this.origin) return;
			this.itemsCache = this.model.toArray();
			this.onUpdate({ items: this.itemsCache, source: 'yjs' });
			this.emit();
		};

		this.yarray.observeDeep(deepObserver);
		this.unsubs.push(() => this.yarray.unobserveDeep(deepObserver));
	}

	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	public getItems(): readonly ChecklistItem[] {
		return this.itemsCache;
	}

	public add(item: { id: string; text: string; completed: boolean }): void {
		if (this.destroyed) return;
		const id = typeof item.id === 'string' ? item.id.trim() : '';
		if (id.length === 0) {
			throw new TypeError('ChecklistBinding.add: item.id must be a non-empty string');
		}
		this.transact(() => {
			const m = new Y.Map<any>();
			m.set('id', id);
			m.set('text', String(item.text ?? ''));
			m.set('completed', Boolean(item.completed));
			this.yarray.push([m]);
		});
		// Ensure immediate notification (without relying on observeDeep timing).
		this.itemsCache = this.model.toArray();
		this.onUpdate({ items: this.itemsCache, source: 'yjs' });
		this.emit();
	}

	public remove(index: number): void {
		if (this.destroyed) return;
		const idx = this.normalizeIndex(index);
		if (idx === null) return;
		const item = this.yarray.get(idx);
		if (!item) return;
		const id = String(item.get('id') ?? '').trim();
		if (id.length === 0) return;
		this.removeById(id);
	}

	public update(
		index: number,
		partial: Partial<{ id: string; text: string; completed: boolean }>
	): void {
		if (this.destroyed) return;
		const idx = this.normalizeIndex(index);
		if (idx === null) return;
		const item = this.yarray.get(idx);
		if (!item) return;
		const id = String(item.get('id') ?? '').trim();
		if (id.length === 0) return;
		this.updateById(id, partial);
	}

	public removeById(id: string): void {
		if (this.destroyed) return;
		const normalizedId = String(id ?? '').trim();
		if (normalizedId.length === 0) return;

		const idx = this.findIndexById(normalizedId);
		if (idx === -1) return;

		this.transact(() => {
			this.yarray.delete(idx, 1);
		});
		this.itemsCache = this.model.toArray();
		this.onUpdate({ items: this.itemsCache, source: 'yjs' });
		this.emit();
	}

	public updateById(
		id: string,
		partial: Partial<{ id: string; text: string; completed: boolean }>
	): void {
		if (this.destroyed) return;
		const normalizedId = String(id ?? '').trim();
		if (normalizedId.length === 0) return;

		const idx = this.findIndexById(normalizedId);
		if (idx === -1) return;

		this.transact(() => {
			const m = this.yarray.get(idx);
			if (!m) return;

			if (partial.id !== undefined) {
				const id = String(partial.id).trim();
				if (id.length === 0) {
					throw new TypeError('ChecklistBinding.update: partial.id must be a non-empty string');
				}
				m.set('id', id);
			}
			if (partial.text !== undefined) {
				m.set('text', String(partial.text));
			}
			if (partial.completed !== undefined) {
				m.set('completed', Boolean(partial.completed));
			}
		});
		this.itemsCache = this.model.toArray();
		this.onUpdate({ items: this.itemsCache, source: 'yjs' });
		this.emit();
	}

	public destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		for (const unsub of this.unsubs.splice(0)) {
			unsub();
		}
		this.listeners.clear();
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	private transact(fn: () => void): void {
		const doc = (this.yarray as any).doc as Y.Doc | null | undefined;
		if (doc) {
			doc.transact(fn, this.origin);
			return;
		}
		fn();
	}

	private normalizeIndex(index: number): number | null {
		if (!Number.isFinite(index) || !Number.isInteger(index)) {
			throw new TypeError('ChecklistBinding index must be an integer');
		}
		if (index < 0 || index >= this.yarray.length) {
			return null;
		}
		return index;
	}

	private findIndexById(id: string): number {
		const arr = this.yarray.toArray();
		for (let i = 0; i < arr.length; i++) {
			if (String(arr[i].get('id') ?? '').trim() === id) {
				return i;
			}
		}
		return -1;
	}
}
