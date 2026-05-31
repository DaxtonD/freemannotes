export type MoveNoteMetadataIdPair = {
	sourceId: string;
	targetId: string;
};

export type MoveNoteMetadataMapping = {
	collectionId: string | null;
	labelIds: string[];
	collectionIdPairs: MoveNoteMetadataIdPair[];
	labelIdPairs: MoveNoteMetadataIdPair[];
};

export const EMPTY_MOVE_NOTE_METADATA_MAPPING: MoveNoteMetadataMapping = {
	collectionId: null,
	labelIds: [],
	collectionIdPairs: [],
	labelIdPairs: [],
};