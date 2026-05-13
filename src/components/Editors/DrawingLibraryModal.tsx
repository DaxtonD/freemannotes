import React from 'react';
import { createPortal } from 'react-dom';
import modalStyles from '../NoteCard/NoteColorPickerModal.module.css';

export type DrawingLibraryDefinition = {
	id: string;
	name: string;
	author: string;
	description: string;
};

type DrawingLibraryModalProps = {
	isOpen: boolean;
	importingLibraryId: string | null;
	onClose: () => void;
	onImport: (library: DrawingLibraryDefinition) => Promise<void>;
};

export function DrawingLibraryModal(props: DrawingLibraryModalProps): React.JSX.Element | null {
	const [libraries, setLibraries] = React.useState<DrawingLibraryDefinition[]>([]);
	const [isLoading, setIsLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') props.onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [props.isOpen, props.onClose]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		const controller = new AbortController();
		setIsLoading(true);
		setError(null);
		void fetch('/api/excalidraw-libraries', {
			credentials: 'same-origin',
			signal: controller.signal,
		})
			.then(async (response) => {
				if (!response.ok) {
					throw new Error('Unable to load drawing libraries.');
				}
				return response.json() as Promise<{ libraries?: DrawingLibraryDefinition[] }>;
			})
			.then((payload) => {
				setLibraries(Array.isArray(payload.libraries) ? payload.libraries : []);
			})
			.catch((fetchError: unknown) => {
				if (controller.signal.aborted) return;
				setError(fetchError instanceof Error ? fetchError.message : 'Unable to load drawing libraries.');
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setIsLoading(false);
				}
			});
		return () => controller.abort();
	}, [props.isOpen]);

	if (!props.isOpen || typeof document === 'undefined') return null;

	return createPortal(
		<div className={modalStyles.overlay} role="presentation" onClick={props.onClose}>
			<section
				className={modalStyles.modal}
				role="dialog"
				aria-modal="true"
				aria-label="Drawing libraries"
				onClick={(event) => event.stopPropagation()}
			>
				<header className={modalStyles.header}>
					<div>
						<h3 className={modalStyles.title}>Drawing libraries</h3>
						<p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>
							Import a public Excalidraw library, then pick shapes from the library sidebar.
						</p>
					</div>
					<button type="button" className={modalStyles.closeButton} onClick={props.onClose} aria-label="Close drawing libraries">
						✕
					</button>
				</header>
				{error ? (
					<div style={{ color: 'var(--color-danger, #b91c1c)', fontSize: 13 }}>{error}</div>
				) : null}
				<div className={modalStyles.grid} role="list" aria-label="Drawing library options" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
					{isLoading ? (
						<div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Loading libraries…</div>
					) : null}
					{!isLoading ? libraries.map((library) => {
						const isImporting = props.importingLibraryId === library.id;
						return (
							<button
								key={library.id}
								type="button"
								role="listitem"
								className={modalStyles.option}
								disabled={isImporting}
								onClick={() => void props.onImport(library)}
								style={{ alignItems: 'stretch', minHeight: 136 }}
							>
								<span className={modalStyles.label} style={{ fontSize: 13 }}>{library.name}</span>
								<span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{library.author}</span>
								<span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--color-text)' }}>{library.description}</span>
								<span style={{ marginTop: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--color-accent)' }}>
									{isImporting ? 'Importing…' : 'Import library'}
								</span>
							</button>
						);
					}) : null}
				</div>
			</section>
		</div>,
		document.body
	);
}