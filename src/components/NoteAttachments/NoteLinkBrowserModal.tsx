import React from 'react';
import type * as Y from 'yjs';
import { useI18n } from '../../core/i18n';
import { extractNoteLinksFromDoc, type ExtractedNoteLink } from '../../core/noteLinks';
import { NoteLinkPanel } from '../NoteLinks/NoteLinkPanel';
import { AttachmentBrowserModalFrame } from './AttachmentBrowserModalFrame';

type NoteLinkBrowserModalProps = {
	isOpen: boolean;
	docId: string | null;
	doc?: Y.Doc | null;
	authUserId?: string | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onDeleteLink?: (normalizedUrl: string) => void;
	onAddUrlPreview?: (() => void) | undefined;
};

export function NoteLinkBrowserModal(props: NoteLinkBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [fallbackLinks, setFallbackLinks] = React.useState<readonly ExtractedNoteLink[]>(() => props.doc ? extractNoteLinksFromDoc(props.doc) : []);

	React.useEffect(() => {
		// Mirror the live Yjs link list so the browser can render immediately even before
		// the server-side preview resolver finishes hydrating stored preview records.
		if (!props.doc) {
			setFallbackLinks([]);
			return;
		}
		const syncLinks = (): void => {
			setFallbackLinks(extractNoteLinksFromDoc(props.doc as Y.Doc));
		};
		syncLinks();
		props.doc.on('update', syncLinks);
		return () => {
			props.doc?.off('update', syncLinks);
		};
	}, [props.doc]);

	if (!props.isOpen || !props.docId) return null;

	return (
		<AttachmentBrowserModalFrame
			isOpen={props.isOpen}
			noteTitle={props.noteTitle}
			subtitle={t('editors.mediaTabLinks')}
			onClose={props.onClose}
			closeLabel={t('common.close')}
		>
			<NoteLinkPanel
				docId={props.docId}
				authUserId={props.authUserId}
				fallbackLinks={fallbackLinks}
				canEdit={props.canEdit}
				onDeleteLink={props.onDeleteLink}
				onAddUrlPreview={props.onAddUrlPreview}
			/>
		</AttachmentBrowserModalFrame>
	);
}