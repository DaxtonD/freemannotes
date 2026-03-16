import React from 'react';
import DocViewer, { DocViewerRenderers, type IAnnotation, type IDocument, type IConfig } from '@iamjariwala/react-doc-viewer';
import '@iamjariwala/react-doc-viewer/dist/index.css';
import { useI18n } from '../../core/i18n';
import { resolveNoteDocumentBlob, readStoredNoteDocumentAnnotations, writeStoredNoteDocumentAnnotations } from '../../core/noteDocumentStore';
import type { NoteDocumentRecord } from '../../core/noteDocumentApi';
import styles from './NoteDocumentViewer.module.css';

type NoteDocumentViewerProps = {
	document: NoteDocumentRecord;
	onResolvedDocumentUrlChange?: ((url: string | null) => void) | undefined;
};

/** Fallback component shown when the library has no built-in renderer for
 *  the file type (e.g. .ods, .odp). Renders a download card. */
function NoRendererFallback(props: { document: IDocument | undefined; fileName: string }): React.JSX.Element {
	const { t } = useI18n();
	return (
		<div className={styles.fallbackCard}>
			<p className={styles.fallbackLabel}>{props.fileName || t('documents.previewUnavailable')}</p>
			<p className={styles.fallbackHint}>{t('documents.previewUnavailable')}</p>
			{props.document?.uri ? (
				<a className={styles.fallbackDownload} href={props.document.uri} download={props.fileName}>
					{t('documents.download') || 'Download'}
				</a>
			) : null}
		</div>
	);
}

function isAnnotation(value: unknown): value is IAnnotation {
	if (!value || typeof value !== 'object') return false;
	const candidate = value as Partial<IAnnotation>;
	return typeof candidate.id === 'string'
		&& (candidate.type === 'highlight' || candidate.type === 'drawing' || candidate.type === 'comment')
		&& typeof candidate.pageNumber === 'number'
		&& typeof candidate.color === 'string';
}

function normalizeStoredAnnotations(value: unknown): IAnnotation[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isAnnotation);
}

function annotationsEqual(left: readonly IAnnotation[], right: readonly IAnnotation[]): boolean {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return false;
	}
	return true;
}

export function NoteDocumentViewer(props: NoteDocumentViewerProps): React.JSX.Element {
	const { locale, t } = useI18n();
	const previewUnavailableLabel = t('documents.previewUnavailable');
	const documentId = props.document.id;
	const docId = props.document.docId;

	// ----- Loading states -----
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
	const [annotationsLoaded, setAnnotationsLoaded] = React.useState(false);

	// ----- Stable refs for annotation persistence (avoids config instability) -----
	const storedAnnotationsRef = React.useRef<IAnnotation[]>([]);
	const documentIdRef = React.useRef(documentId);
	documentIdRef.current = documentId;
	const docIdRef = React.useRef(docId);
	docIdRef.current = docId;

	// ----- Load annotations from IndexedDB -----
	React.useEffect(() => {
		let cancelled = false;
		setAnnotationsLoaded(false);
		void (async () => {
			const stored = normalizeStoredAnnotations(
				await readStoredNoteDocumentAnnotations(documentId),
			);
			if (cancelled) return;
			storedAnnotationsRef.current = stored;
			setAnnotationsLoaded(true);
		})();
		return () => { cancelled = true; };
	}, [documentId]);

	// ----- Load blob -----
	React.useEffect(() => {
		let cancelled = false;
		let objectUrl: string | null = null;
		setIsLoading(true);
		setError(null);
		setBlobUrl(null);
		props.onResolvedDocumentUrlChange?.(null);
		void (async () => {
			// Resolve through the offline-first store so the embedded viewer can reopen
			// remote documents without a network roundtrip when the blob is cached.
			const blob = await resolveNoteDocumentBlob(props.document);
			if (cancelled) return;
			if (!blob) {
				setError(previewUnavailableLabel);
				setIsLoading(false);
				return;
			}
			objectUrl = URL.createObjectURL(blob);
			setBlobUrl(objectUrl);
			props.onResolvedDocumentUrlChange?.(objectUrl);
			setIsLoading(false);
		})();
		return () => {
			cancelled = true;
			props.onResolvedDocumentUrlChange?.(null);
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [
		previewUnavailableLabel,
		props.document.id,
		props.document.docId,
		props.document.originalUrl,
		props.document.updatedAt,
		props.document.isLocal,
		props.onResolvedDocumentUrlChange,
	]);

	// ----- Stable annotation change handler (identity never changes) -----
	// Uses refs so the config object that contains this callback is never recreated.
	const onAnnotationChange = React.useCallback((annotations: IAnnotation[]) => {
		const stableUri = `freemannotes-document:${documentIdRef.current}`;
		const normalized = annotations.map((a) => ({ ...a, documentUri: stableUri }));
		if (annotationsEqual(storedAnnotationsRef.current, normalized)) return;
		storedAnnotationsRef.current = normalized;
		void writeStoredNoteDocumentAnnotations({
			documentId: documentIdRef.current,
			docId: docIdRef.current,
			annotationsJson: normalized,
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// ----- Documents array -----
	// Pass the file extension (e.g. "xlsx") as fileType rather than MIME type.
	// The library's renderers include extensions in their fileTypes arrays, and
	// using extensions avoids the "application/octet-stream" mis-match where the
	// DocxRenderer (weight 1) would claim xlsx/xls files before MSDocRenderer
	// (weight 0), then fail to parse them.
	const documents = React.useMemo<IDocument[]>(() => {
		if (!blobUrl) return [];
		const ext = (props.document.fileExtension || '').toLowerCase();
		return [{
			uri: blobUrl,
			fileName: props.document.fileName,
			fileType: ext || props.document.mimeType,
		}];
	}, [blobUrl, props.document.fileName, props.document.fileExtension, props.document.mimeType]);

	// ----- Config — stable per blob URL. -----
	// storedAnnotationsRef is read once (via ref) when blobUrl changes, not as a
	// reactive dependency. onAnnotationChange has a stable identity (empty deps).
	// This means config never changes during the lifetime of a single blob URL,
	// so the library never re-seeds its internal annotation state.
	const config = React.useMemo<IConfig>(() => {
		const initialAnnotations = blobUrl
			? storedAnnotationsRef.current.map((a) => ({ ...a, documentUri: blobUrl }))
			: [];
		return {
			header: { disableFileName: true },
			noRenderer: { overrideComponent: NoRendererFallback },
			pdfZoom: { defaultZoom: 1, zoomJump: 0.2 },
			pdfVerticalScrollByDefault: true,
			themeMode: 'auto',
			print: { enablePrint: true },
			fullscreen: { enableFullscreen: true },
			loadingProgress: { enableProgressBar: true },
			textSelection: { enableTextSelection: true },
			keyboard: { enableKeyboardShortcuts: true },
			password: { enablePasswordPrompt: true },
			search: { enableSearch: true },
			selectionToolbar: {
				enabled: true,
				showHighlightColors: true,
				showCommentButton: true,
				colors: ['#FFFF00', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'],
			},
			bookmarks: { enableBookmarks: false },
			thumbnail: { enableThumbnails: false },
			annotations: {
				enableAnnotations: true,
				defaultColor: '#FFFF00',
				colors: ['#FFFF00', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4'],
				tools: ['select', 'highlight', 'pen', 'comment', 'eraser'],
				onAnnotationChange,
				initialAnnotations,
			},
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [blobUrl, onAnnotationChange]);

	// Gate: don't render DocViewer until both blob and annotations are ready.
	const isReady = !isLoading && annotationsLoaded && blobUrl !== null && documents.length > 0;

	if (!isReady && !error) {
		return <div className={styles.state}><p className={styles.message}>{t('common.loading')}</p></div>;
	}

	if (error || documents.length === 0) {
		return <div className={styles.state}><p className={styles.error}>{error || previewUnavailableLabel}</p></div>;
	}

	return (
		<div className={styles.viewer}>
			<DocViewer
				key={blobUrl}
				className={styles.docViewer}
				style={{ width: '100%', height: '100%' }}
				documents={documents}
				pluginRenderers={DocViewerRenderers}
				config={config}
				language={locale}
				prefetchMethod="GET"
			/>
		</div>
	);
}
