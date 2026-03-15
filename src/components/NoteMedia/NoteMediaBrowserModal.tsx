import React from 'react';
import { useI18n } from '../../core/i18n';
import { AttachmentBrowserModalFrame } from '../NoteAttachments/AttachmentBrowserModalFrame';
import { NoteMediaPanel } from './NoteMediaPanel';

type NoteMediaBrowserModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onAddImage?: (() => void) | undefined;
};

export function NoteMediaBrowserModal(props: NoteMediaBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();

	if (!props.isOpen || !props.docId) return null;

	return (
		<AttachmentBrowserModalFrame
			isOpen={props.isOpen}
			noteTitle={props.noteTitle}
			subtitle={t('app.sidebarImages')}
			onClose={props.onClose}
			closeLabel={t('common.close')}
		>
			<NoteMediaPanel
				docId={props.docId}
				authUserId={props.authUserId}
				canEdit={props.canEdit}
				onAddImage={props.onAddImage}
			/>
		</AttachmentBrowserModalFrame>
	);
}
