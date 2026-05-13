import React from 'react';
import * as Y from 'yjs';
import { useI18n } from '../../core/i18n';
import { DrawingsPanel } from '../Editors/DrawingsPanel';
import { AttachmentBrowserModalFrame } from './AttachmentBrowserModalFrame';

type NoteDrawingBrowserModalProps = {
	isOpen: boolean;
	doc: Y.Doc | null;
	canEdit: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onAddDrawing?: (() => void) | undefined;
	onOpenDrawing?: ((drawingId: string) => void) | undefined;
	onDeleteDrawing?: ((drawingId: string) => Promise<void> | void) | undefined;
	loadDrawingDoc?: ((drawingId: string) => Promise<Y.Doc | null>) | undefined;
};

export function NoteDrawingBrowserModal(props: NoteDrawingBrowserModalProps): React.JSX.Element | null {
	const { t } = useI18n();

	if (!props.isOpen || !props.doc) return null;

	return (
		<AttachmentBrowserModalFrame
			isOpen={props.isOpen}
			noteTitle={props.noteTitle}
			subtitle={t('editors.mediaTabDocuments')}
			onClose={props.onClose}
			closeLabel={t('common.close')}
		>
			<DrawingsPanel
				doc={props.doc}
				canEdit={props.canEdit}
				onAddDrawing={props.onAddDrawing}
				onOpenDrawing={props.onOpenDrawing}
				onDeleteDrawing={props.onDeleteDrawing}
				loadDrawingDoc={props.loadDrawingDoc}
			/>
		</AttachmentBrowserModalFrame>
	);
}
