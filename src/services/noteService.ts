import * as Y from 'yjs';
import {
	readCollectionState,
	readLabelState,
	readLastAccessedAt,
	readPinState,
	readReminderState,
	setNoteCollection,
	setNoteLabelIds,
	setNotePinned,
	setNoteReminder,
	touchLastAccessedAt,
} from '../core/noteModel';

// Keep metadata mutations behind a tiny service layer so UI components do not need
// to know the exact Yjs metadata map shape.
export function assignNoteToCollection(doc: Y.Doc, collectionId: string | null): void {
	setNoteCollection(doc, collectionId);
}

export function assignNoteLabels(doc: Y.Doc, labelIds: readonly string[]): void {
	setNoteLabelIds(doc, labelIds);
}

export function assignNoteReminder(doc: Y.Doc, reminderAt: string | null): void {
	setNoteReminder(doc, reminderAt);
}

export function assignNotePinned(doc: Y.Doc, isPinned: boolean): void {
	setNotePinned(doc, isPinned);
}

export function markNoteAccessed(doc: Y.Doc, origin?: symbol): void {
	touchLastAccessedAt(doc, origin);
}

export function readNoteMetadataState(doc: Y.Doc): {
	collectionId: string | null;
	labelIds: string[];
	reminderAt: string | null;
	isPinned: boolean;
	lastAccessedAt: string;
} {
	return {
		collectionId: readCollectionState(doc).collectionId,
		labelIds: readLabelState(doc).labelIds,
		reminderAt: readReminderState(doc).reminderAt,
		isPinned: readPinState(doc).isPinned,
		lastAccessedAt: readLastAccessedAt(doc),
	};
}