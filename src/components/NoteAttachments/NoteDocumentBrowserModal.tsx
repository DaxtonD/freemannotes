import React from 'react';
import { useI18n } from '../../core/i18n';
import { DocumentsPanel } from '../Editors/DocumentsPanel';
import { AttachmentBrowserModalFrame } from './AttachmentBrowserModalFrame';

type NoteDocumentBrowserModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onAddDocument?: (() => void) | undefined;
};

export function NoteDocumentBrowserModal(props: NoteDocumentBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();

	if (!props.isOpen || !props.docId) return null;

	// The browser modal is intentionally thin: DocumentsPanel owns document behavior,
	// while this wrapper only maps it into the shared attachment modal shell.
	return (
		<AttachmentBrowserModalFrame
			isOpen={props.isOpen}
			noteTitle={props.noteTitle}
			subtitle={t('editors.mediaTabDocuments')}
			onClose={props.onClose}
			closeLabel={t('common.close')}
		>
			<DocumentsPanel
				docId={props.docId}
				authUserId={props.authUserId}
				canEdit={props.canEdit}
				onAddDocument={props.onAddDocument}
			/>
		</AttachmentBrowserModalFrame>
	);
}