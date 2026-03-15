import React from 'react';
import pdfWorkerSrc from './pdfWorkerProxy?worker&url';
import { PdfHighlighter, PdfLoader } from 'react-pdf-highlighter-plus';
import { useI18n } from '../../core/i18n';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import styles from './PdfDocumentViewer.module.css';

type PdfDocumentViewerProps = {
	document: NoteDocumentRecord;
	authUserId?: string | null;
	canEdit?: boolean;
};

export function PdfDocumentViewer(props: PdfDocumentViewerProps): React.JSX.Element {
	const { t } = useI18n();

	// Annotations were intentionally removed for now; keep the embedded viewer focused
	// on reliable read-only rendering until a simpler annotation model returns.
	return (
		<div className={styles.viewer}>
			<div className={styles.canvas}>
				<PdfLoader
					document={props.document.originalUrl}
					workerSrc={pdfWorkerSrc}
					beforeLoad={() => <div className={styles.loadState}><p className={styles.loading}>{t('common.loading')}</p></div>}
					errorMessage={(error) => <div className={styles.loadState}><p className={styles.loadError}>{error.message || t('documents.pdfLoadFailed')}</p></div>}
				>
					{(pdfDocument) => (
						<PdfHighlighter
							pdfDocument={pdfDocument}
							highlights={[]}
							pdfScaleValue="page-width"
							textSelectionColor="rgba(255, 226, 143, 0.4)"
							utilsRef={() => undefined}
						>
							{null}
						</PdfHighlighter>
					)}
				</PdfLoader>
			</div>
		</div>
	);
}