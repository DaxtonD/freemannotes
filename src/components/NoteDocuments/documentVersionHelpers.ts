// Small shared bits for the version history modal, kept out of the modal so it doesn't pull the
// whole document store in just for a file-type check.

import { getDocumentUploadMaxBytes } from '../../core/instanceConfig';

export { NOTE_DOCUMENT_ACCEPT, isSupportedNoteDocumentFile } from '../../core/noteDocumentStore';

/** The server's upload limit, as it reads in a message ("100 MB"). */
export function getDocumentUploadMaxBytesLabel(): string {
	return `${Math.round(getDocumentUploadMaxBytes() / (1024 * 1024))} MB`;
}
