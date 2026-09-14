import React from 'react';
import { useI18n } from '../../core/i18n';
import { DocumentsPanel } from '../NoteDocuments/DocumentsPanel';
import { AttachmentBrowserModalFrame } from './AttachmentBrowserModalFrame';

type NoteDocumentBrowserModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onShowBriefDialog?: ((message: string) => void) | undefined;
};

// Opened from a note card's attachment chip. Deliberately thin: DocumentsPanel owns all
// document behaviour, so the card browser and the editor's Documents tab can't drift apart.
export function NoteDocumentBrowserModal(props: NoteDocumentBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();

	if (!props.isOpen || !props.docId) return null;

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
				onShowBriefDialog={props.onShowBriefDialog}
			/>
		</AttachmentBrowserModalFrame>
	);
}
