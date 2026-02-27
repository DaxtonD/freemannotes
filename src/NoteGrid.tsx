import React from 'react';
import type * as Y from 'yjs';
import {
	closestCenter,
	DndContext,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
	type DragStartEvent,
	type DragCancelEvent,
	type DragEndEvent,
	type UniqueIdentifier,
} from '@dnd-kit/core';
import {
	SortableContext,
	rectSortingStrategy,
	useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { NoteCard } from './NoteCard';
import { useDocumentManager } from './core/DocumentManagerContext';

// Phase 6 (NO Muuri): ordering is `noteOrder` (Y.Array<string>), layout is CSS grid,
// and drag uses dnd-kit with handle-only activation on `.note-header`.

export type NoteGridProps = {
	selectedNoteId: string | null;
	onSelectNote: (noteId: string) => void;
};

// Yjs types don't expose `.doc` on arrays, but it exists at runtime.
type YArrayWithDoc<T> = Y.Array<T> & { doc: Y.Doc };

function normalizeId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function uniqueIds(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of values) {
		const id = normalizeId(value);
		if (!id) continue;
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

function readRegistryIds(notesList: Y.Array<Y.Map<unknown>>): string[] {
	// Registry list items are Y.Maps with at least an `id` field.
	return uniqueIds(notesList.toArray().map((item) => normalizeId(item.get('id'))));
}

function readOrderIds(noteOrder: Y.Array<string>): string[] {
	return uniqueIds(noteOrder.toArray().map((id) => normalizeId(id)));
}

function ensureOrderContainsAllRegistryIds(noteOrder: Y.Array<string>, registryIds: readonly string[]): void {
	// Spec: noteOrder remains authoritative.
	// If older persisted data has registry IDs not present in noteOrder, append them.
	const current = new Set(readOrderIds(noteOrder));
	const missing = registryIds.filter((id) => !current.has(id));
	if (missing.length === 0) return;

	const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
	ydoc.transact(() => {
		noteOrder.insert(noteOrder.length, missing);
	});
}

type SortableNoteCardProps = {
	noteId: string;
	doc: Y.Doc;
	selected: boolean;
	onOpen: () => void;
};

function SortableNoteCard(props: SortableNoteCardProps): React.JSX.Element {
	// Spec: each card must be wrapped with useSortable({ id: note.id }).
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: props.noteId });

	// Spec: apply transform/transition styles using CSS.Transform.
	const transformNoScale = transform ? { ...transform, scaleX: 1, scaleY: 1 } : null;
	const style: React.CSSProperties = {
		transform: CSS.Transform.toString(transformNoScale),
		transition,
		// When using DragOverlay, hide the original while dragging.
		opacity: isDragging ? 0 : 1,
	};

	return (
		<div ref={setNodeRef} style={style} className="note-grid-item" data-note-id={props.noteId}>
			<div className={props.selected ? 'note-grid-item-selected' : undefined}>
				<NoteCard
					noteId={props.noteId}
					doc={props.doc}
					onOpen={props.onOpen}
					// Spec: drag handle must be ".note-header" only.
					dragHandleRef={setActivatorNodeRef}
					dragHandleProps={{
						...attributes,
						...listeners,
					}}
				/>
			</div>
		</div>
	);
}

export function NoteGrid(props: NoteGridProps): React.JSX.Element {
	const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
	const [activeDragSize, setActiveDragSize] = React.useState<{ width: number; height: number } | null>(null);
	const manager = useDocumentManager();

	// Stable Yjs collections from the registry doc.
	const [notesList, setNotesList] = React.useState<Y.Array<Y.Map<unknown>> | null>(null);
	const [noteOrder, setNoteOrder] = React.useState<Y.Array<string> | null>(null);

	// Cache of per-note docs loaded via DocumentManager (hydrated from IndexedDB).
	const [docsById, setDocsById] = React.useState<Record<string, Y.Doc>>({});
	const docsByIdRef = React.useRef<Record<string, Y.Doc>>({});
	const pendingDocLoadsRef = React.useRef<Set<string>>(new Set());

	// External store version counter for useSyncExternalStore.
	const versionRef = React.useRef(0);

	React.useEffect(() => {
		docsByIdRef.current = docsById;
	}, [docsById]);

	React.useEffect(() => {
		let cancelled = false;
		(async () => {
			// Offline-first: awaits IndexedDB hydration; websocket can connect later.
			const [list, order] = await Promise.all([manager.getNotesList(), manager.getNoteOrder()]);
			if (cancelled) return;
			setNotesList(list as unknown as Y.Array<Y.Map<unknown>>);
			setNoteOrder(order);
		})();
		return () => {
			cancelled = true;
		};
	}, [manager]);

	// Subscribe to Yjs updates so React re-renders when order/registry changes.
	const subscribe = React.useCallback(
		(onStoreChange: () => void) => {
			if (!notesList || !noteOrder) return () => {};

			const onChange = (): void => {
				versionRef.current += 1;
				onStoreChange();
			};

			notesList.observeDeep(onChange);
			noteOrder.observe(onChange);

			return () => {
				notesList.unobserveDeep(onChange);
				noteOrder.unobserve(onChange);
			};
		},
		[notesList, noteOrder]
	);

	const getSnapshot = React.useCallback(() => versionRef.current, []);
	const storeVersion = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	// Spec: rendered order must be derived from noteOrder.
	const orderedIds = React.useMemo<string[]>(() => {
		if (!noteOrder) return [];
		return readOrderIds(noteOrder);
	}, [noteOrder, storeVersion]);

	// Optional safety/migration: ensure noteOrder contains all known note IDs.
	React.useEffect(() => {
		if (!notesList || !noteOrder) return;
		const registryIds = readRegistryIds(notesList);
		const current = readOrderIds(noteOrder);

		// If noteOrder is empty but registry has notes, initialize once.
		if (current.length === 0 && registryIds.length > 0) {
			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.insert(0, registryIds);
			});
			return;
		}

		ensureOrderContainsAllRegistryIds(noteOrder, registryIds);
	}, [notesList, noteOrder, storeVersion]);

	// Offline-first doc loading: load docs needed for visible IDs.
	React.useEffect(() => {
		let cancelled = false;
		if (!noteOrder) return;

		for (const id of orderedIds) {
			if (docsByIdRef.current[id]) continue;
			if (pendingDocLoadsRef.current.has(id)) continue;
			pendingDocLoadsRef.current.add(id);

			void manager
				.getDocWithSync(id)
				.then((doc) => {
					if (cancelled) return;
					setDocsById((prev) => (prev[id] ? prev : { ...prev, [id]: doc }));
				})
				.catch((err) => {
					console.error('[CRDT] Failed to load note doc:', id, err);
				})
				.finally(() => {
					pendingDocLoadsRef.current.delete(id);
				});
		}

		return () => {
			cancelled = true;
		};
	}, [manager, noteOrder, orderedIds]);

	// Spec: PointerSensor with distance activation constraint (touch-friendly).
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: { distance: 6 },
		})
	);

	// Spec: CRDT-safe drag end reorder inside doc.transact().
	const onDragStart = React.useCallback((event: DragStartEvent) => {
		setActiveDragId(normalizeId(event.active.id));
		const rect =
			((event.active.rect.current as any)?.initial as { width: number; height: number } | undefined) ??
			((event.active.rect.current as any)?.translated as { width: number; height: number } | undefined) ??
			((event.active.rect.current as any) as { width: number; height: number } | undefined);
		if (rect && Number.isFinite(rect.width) && Number.isFinite(rect.height)) {
			setActiveDragSize({ width: rect.width, height: rect.height });
		} else {
			setActiveDragSize(null);
		}
	}, []);

	const onDragCancel = React.useCallback((_event: DragCancelEvent) => {
		setActiveDragId(null);
		setActiveDragSize(null);
	}, []);

	const onDragEnd = React.useCallback(
		(event: DragEndEvent) => {
			setActiveDragId(null);
			setActiveDragSize(null);
			if (!noteOrder) return;
			const activeId = normalizeId(event.active.id);
			const overId = event.over ? normalizeId(event.over.id) : '';
			if (!overId) return;
			if (activeId === overId) return;

			const ids = readOrderIds(noteOrder);
			const oldIndex = ids.indexOf(activeId);
			const newIndex = ids.indexOf(overId);
			if (oldIndex < 0 || newIndex < 0) {
				console.warn('[DND] Drag ids not found in noteOrder:', { activeId, overId });
				return;
			}
			if (oldIndex === newIndex) return;

			const ydoc = (noteOrder as YArrayWithDoc<string>).doc;
			ydoc.transact(() => {
				noteOrder.delete(oldIndex, 1);
				const insertIndex = oldIndex < newIndex ? newIndex - 1 : newIndex;
				noteOrder.insert(insertIndex, [activeId]);
			});
		},
		[noteOrder]
	);

	// dnd-kit requires stable identifiers list.
	const sortableIds = React.useMemo<UniqueIdentifier[]>(() => orderedIds, [orderedIds]);

	return (
		<section aria-label="Notes" className="note-grid-section">
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={onDragStart}
				onDragCancel={onDragCancel}
				onDragEnd={onDragEnd}
			>
				<SortableContext items={sortableIds} strategy={rectSortingStrategy}>
					<div className="note-grid" aria-label="Notes Grid">
						{orderedIds.map((id) => {
							const doc = docsById[id];
							if (!doc) {
								return (
									<div key={id} className="note-grid-item" data-note-id={id}>
										<div className="note-card">Loading…</div>
									</div>
								);
							}

							return (
								<SortableNoteCard
									key={id}
									noteId={id}
									doc={doc}
									selected={props.selectedNoteId === id}
									onOpen={() => props.onSelectNote(id)}
								/>
							);
						})}
					</div>
				</SortableContext>
				<DragOverlay adjustScale={false}>
					{activeDragId && docsById[activeDragId] ? (
						<div
							className="note-grid-item"
							style={{
								pointerEvents: 'none',
								width: activeDragSize?.width,
								height: activeDragSize?.height,
							}}
						>
							<NoteCard noteId={activeDragId} doc={docsById[activeDragId]} />
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</section>
	);
}

