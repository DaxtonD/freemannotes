import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faChevronDown, faChevronUp, faImage, faPen, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { queueNoteImageUrlForImport, queueNoteImagesForUpload, readQueuedNoteImages, readStoredRemoteNoteImages } from '../../core/noteMediaStore';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import styles from './NoteImageUploadModal.module.css';

type SelectedFile = { file: File; name: string; defaultName: string; previewUrl: string };

type NoteImageUploadModalProps = {
	isOpen: boolean;
	docId: string | null;
	authUserId?: string | null;
	offlineMode?: boolean;
	noteTitle?: string | null;
	onClose: () => void;
	onUploaded?: (result: { queued: boolean; count: number }) => void;
};

function stripExtension(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function getExtension(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	return lastDot > 0 ? filename.slice(lastDot) : '';
}

function selectAllText(input: HTMLInputElement): void {
	const applySelection = (): void => {
		try {
			input.focus();
			input.setSelectionRange(0, input.value.length);
		} catch {
			input.select();
		}
	};
	applySelection();
	window.requestAnimationFrame(applySelection);
}

export function NoteImageUploadModal(props: NoteImageUploadModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const fileInputRef = React.useRef<HTMLInputElement | null>(null);
	const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
	const dialogRef = React.useRef<HTMLElement | null>(null);
	const photoCounterRef = React.useRef(0);
	const interactionShieldUntilRef = React.useRef(0);
	const interactionShieldBlocksClickRef = React.useRef(false);
	const cameraOpenRef = React.useRef(false);
	const openingCameraPickerRef = React.useRef(false);
	const cameraFallbackTimerRef = React.useRef(0);
	const cameraCapturedAtRef = React.useRef(0);
	const justFocusedRef = React.useRef<number>(-1);

	const [selected, setSelected] = React.useState<SelectedFile[]>([]);
	const [imageUrl, setImageUrl] = React.useState('');
	const [urlSectionOpen, setUrlSectionOpen] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	const keyboard = useKeyboardHeight();
	const [toastMessage, setToastMessage] = React.useState<string | null>(null);
	const toastTimerRef = React.useRef<number>(0);

	const clearCameraShield = React.useCallback((): void => {
		cameraOpenRef.current = false;
		cameraCapturedAtRef.current = 0;
		openingCameraPickerRef.current = false;
		window.clearTimeout(cameraFallbackTimerRef.current);
		try { sessionStorage.removeItem('__freemannotes_cameraActive'); } catch { /* */ }
	}, []);

	React.useEffect(() => {
		if (!props.isOpen) {
			setSelected((prev) => {
				for (const item of prev) URL.revokeObjectURL(item.previewUrl);
				return [];
			});
			setImageUrl('');
			setUrlSectionOpen(false);
			setError(null);
			setToastMessage(null);
			window.clearTimeout(toastTimerRef.current);
			photoCounterRef.current = 0;
			interactionShieldUntilRef.current = 0;
			interactionShieldBlocksClickRef.current = false;
			clearCameraShield();
		}
	}, [clearCameraShield, props.isOpen]);

	React.useEffect(() => {
		if (!props.isOpen) return;
		const absorbTransientInteraction = (event: Event): void => {
			if (openingCameraPickerRef.current) return;
			const now = performance.now();
			const target = event.target;
			const inDialog = target instanceof Node && dialogRef.current?.contains(target);
			if (
				cameraOpenRef.current
				&& inDialog
				&& (event.type === 'pointerdown' || event.type === 'mousedown' || event.type === 'touchstart')
				&& cameraCapturedAtRef.current > 0
				&& now - cameraCapturedAtRef.current > 500
			) {
				clearCameraShield();
				return;
			}
			const shieldByTimer = performance.now() < interactionShieldUntilRef.current
				&& (event.type !== 'click' || interactionShieldBlocksClickRef.current);
			if (!shieldByTimer && !cameraOpenRef.current) return;
			event.preventDefault();
			event.stopPropagation();
			const maybeImmediate = event as Event & { stopImmediatePropagation?: () => void };
			maybeImmediate.stopImmediatePropagation?.();
		};
		window.addEventListener('click', absorbTransientInteraction, true);
		window.addEventListener('mouseup', absorbTransientInteraction, true);
		window.addEventListener('pointerup', absorbTransientInteraction, true);
		window.addEventListener('touchend', absorbTransientInteraction, true);
		window.addEventListener('mousedown', absorbTransientInteraction, true);
		window.addEventListener('pointerdown', absorbTransientInteraction, true);
		window.addEventListener('touchstart', absorbTransientInteraction, true);
		return () => {
			window.removeEventListener('click', absorbTransientInteraction, true);
			window.removeEventListener('mouseup', absorbTransientInteraction, true);
			window.removeEventListener('pointerup', absorbTransientInteraction, true);
			window.removeEventListener('touchend', absorbTransientInteraction, true);
			window.removeEventListener('mousedown', absorbTransientInteraction, true);
			window.removeEventListener('pointerdown', absorbTransientInteraction, true);
			window.removeEventListener('touchstart', absorbTransientInteraction, true);
		};
	}, [clearCameraShield, props.isOpen]);

	// After a page-kill restore, clear the stale camera-active flag.
	// We can't auto-retrigger the file picker because Chrome Android silently
	// blocks programmatic input.click() without a user gesture, which leaves
	// the interaction shield active and the modal unresponsive.
	React.useEffect(() => {
		if (!props.isOpen) return;
		try {
			if (sessionStorage.getItem('__freemannotes_cameraActive') === '1') {
				sessionStorage.removeItem('__freemannotes_cameraActive');
			}
		} catch { /* */ }
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (!props.isOpen || !props.docId) return null;

	const closeAfterKeyboardSettles = (): void => {
		const activeElement = document.activeElement;
		if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
			// Blur first so the keyboard starts dismissing while the modal is still
			// covering the editor. Wait for the keyboard animation to finish (~300ms)
			// so the editor has already settled when the modal unmounts.
			activeElement.blur();
			window.setTimeout(() => props.onClose(), 480);
			return;
		}
		props.onClose();
	};

	const armInteractionShield = (durationMs: number, blocksClick = false): void => {
		interactionShieldUntilRef.current = performance.now() + durationMs;
		interactionShieldBlocksClickRef.current = blocksClick;
	};

	const openCameraPicker = (): void => {
		const input = cameraInputRef.current;
		if (!input) return;
		interactionShieldBlocksClickRef.current = false;
		cameraOpenRef.current = true;
		cameraCapturedAtRef.current = 0;
		openingCameraPickerRef.current = true;
		try { sessionStorage.setItem('__freemannotes_cameraActive', '1'); } catch { /* */ }
		window.clearTimeout(cameraFallbackTimerRef.current);
		try {
			if (typeof input.showPicker === 'function') {
				input.showPicker();
			} else {
				input.click();
			}
		} catch {
			// Fall back to click() when showPicker is unsupported or blocked.
			input.click();
		} finally {
			window.setTimeout(() => {
				openingCameraPickerRef.current = false;
			}, 0);
		}
		// Keep shield for 15s in case camera returns without onChange immediately.
		cameraFallbackTimerRef.current = window.setTimeout(() => {
			clearCameraShield();
		}, 15_000);
	};

	const addToSelected = (newFiles: File[]): void => {
		const entries: SelectedFile[] = newFiles.map((f) => {
			photoCounterRef.current += 1;
			const defaultName = `Image ${photoCounterRef.current}`;
			return {
				file: f,
				name: defaultName,
				defaultName,
				previewUrl: URL.createObjectURL(f),
			};
		});
		setSelected((prev) => [...prev, ...entries]);
		setError(null);
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const newFiles = Array.from(event.target.files || []);
		if (newFiles.length > 0) addToSelected(newFiles);
		event.target.value = '';
	};

	const handleCameraCapture = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const captured = Array.from(event.target.files || []);
		if (captured.length === 0) {
			clearCameraShield();
			event.target.value = '';
			return;
		}
		addToSelected(captured);
		cameraCapturedAtRef.current = performance.now();
		// Keep camera shield active for 15s to handle very long/quick presses on
		// Android's Ok button. It clears early on genuine interaction in the dialog.
		window.clearTimeout(cameraFallbackTimerRef.current);
		cameraFallbackTimerRef.current = window.setTimeout(() => {
			clearCameraShield();
		}, 15_000);
		event.target.value = '';
	};

	const handleRemove = (index: number): void => {
		setSelected((prev) => {
			URL.revokeObjectURL(prev[index].previewUrl);
			return prev.filter((_, i) => i !== index);
		});
	};

	const handleRename = (index: number, newName: string): void => {
		setSelected((prev) => prev.map((item, i) => (i === index ? { ...item, name: newName } : item)));
		setError(null);
	};

	const handleFileSubmit = (): void => {
		if (selected.length === 0) return;
		if (!props.authUserId) {
			setError(t('media.offlineRequiresAuth'));
			return;
		}
		const normalize = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
		void (async () => {
			const remote = await readStoredRemoteNoteImages(props.docId!);
			const queued = await readQueuedNoteImages(props.authUserId!, props.docId!);
			const usedNames = new Set<string>();
			for (const image of remote) {
				const normalized = normalize(stripExtension(image.fileName || ''));
				if (normalized) usedNames.add(normalized);
			}
			for (const row of queued) {
				const normalized = normalize(stripExtension(row.fileName || ''));
				if (normalized) usedNames.add(normalized);
			}

			const toSubmit = selected.slice();
			for (const item of toSubmit) {
				const base = item.name.trim() || item.defaultName;
				const normalized = normalize(base);
				if (!normalized) continue;
				if (usedNames.has(normalized)) {
					setError('Each photo name must be unique in this note.');
					return;
				}
				usedNames.add(normalized);
			}

			// Clear the list immediately so the UI empties before the async operation
			// and keyboard-settle delay complete.
			setSelected((prev) => { for (const item of prev) URL.revokeObjectURL(item.previewUrl); return []; });
			setError(null);
			const toastCount = toSubmit.length;
			window.clearTimeout(toastTimerRef.current);
			setToastMessage(toastCount === 1 ? '1 image successfully added' : `${toastCount} images successfully added`);
			toastTimerRef.current = window.setTimeout(() => setToastMessage(null), 2500);

			armInteractionShield(2600, true);
			const fileNames = toSubmit.map((item) => {
				const ext = getExtension(item.file.name);
				const base = item.name.trim() || item.defaultName;
				return `${base}${ext}`;
			});
			await queueNoteImagesForUpload({
				userId: props.authUserId!,
				docId: props.docId!,
				files: toSubmit.map((item) => item.file),
				fileNames,
			});
			props.onUploaded?.({ queued: true, count: toSubmit.length });
			closeAfterKeyboardSettles();
		})();
	};

	const handleUrlSubmit = (): void => {
		if (!imageUrl.trim()) return;
		if (!props.authUserId) {
			setError(t('media.offlineRequiresAuth'));
			return;
		}
		armInteractionShield(2600, true);
		void queueNoteImageUrlForImport({ userId: props.authUserId, docId: props.docId!, imageUrl: imageUrl.trim() });
		props.onUploaded?.({ queued: true, count: 1 });
		closeAfterKeyboardSettles();
	};

	const count = selected.length;
	const addLabel = count === 1 ? 'Add 1 photo' : `Add ${count} photos`;

	return (
		<div className={styles.backdrop} role="presentation">
			<section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('noteMenu.addImage')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.header}>
					<div>
						<h2 className={styles.title}>{t('noteMenu.addImage')}</h2>
						<p className={styles.subtitle}>{props.noteTitle ? `${t('media.forPrefix')} ${props.noteTitle}` : t('media.attachToNote')}</p>
					</div>
					<button type="button" className={styles.close} onClick={() => { if (!cameraOpenRef.current) props.onClose(); }} aria-label={t('common.close')}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>

				<div className={styles.body}>
					{/* Primary action buttons */}
					<div className={styles.actionRow}>
						<button type="button" className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`} onClick={() => fileInputRef.current?.click()}>
							<FontAwesomeIcon icon={faImage} className={styles.actionIcon} />
							<span>{t('media.chooseFiles')}</span>
						</button>
						<button
							type="button"
							className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`}
							onClick={openCameraPicker}
						>
							<FontAwesomeIcon icon={faCamera} className={styles.actionIcon} />
							<span>{t('media.takePhoto')}</span>
						</button>
					</div>

					{/* Hidden file inputs */}
					<input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={handleFileChange} />
					<input ref={cameraInputRef} className={styles.fileInput} type="file" accept="image/*" capture="environment" onChange={handleCameraCapture} />

					{/* Selected files with inline rename */}
					{count > 0 && (
						<ul className={styles.fileList}>
							{selected.map((item, index) => (
								<li key={item.previewUrl} className={styles.fileRow}>
									<img src={item.previewUrl} alt="" className={styles.fileThumbnail} />
									<label className={styles.fileNameWrap}>
										<FontAwesomeIcon icon={faPen} className={styles.renameIcon} aria-hidden />
										<input
											className={styles.fileNameInput}
											value={item.name}
											placeholder={item.defaultName}
											onChange={(e) => handleRename(index, e.target.value)}
											onFocus={(event) => {
											justFocusedRef.current = index;
											selectAllText(event.currentTarget);
										}}
										onMouseUp={(event) => {
											if (justFocusedRef.current === index) {
												// First tap: prevent browser collapsing the select-all.
												event.preventDefault();
												justFocusedRef.current = -1;
											}
											// Second tap: do nothing — browser places caret naturally,
											// which removes the selection highlight as the user expects.
											}}
											aria-label={`Name for photo ${index + 1}`}
										/>
									</label>
									<button
										type="button"
										className={styles.removeButton}
										onClick={() => handleRemove(index)}
										aria-label={`Remove photo ${index + 1}`}
									>
										<FontAwesomeIcon icon={faXmark} />
									</button>
								</li>
							))}
						</ul>
					)}

					{error ? <p className={styles.error}>{error}</p> : null}

					{count === 0 && (
						<>
							{/* URL import — hidden while photos are pending */}
							<div className={styles.divider} />
							<button type="button" className={styles.urlToggle} onClick={() => setUrlSectionOpen((open) => !open)}>
								{t('media.addFromUrl')}
								<FontAwesomeIcon icon={urlSectionOpen ? faChevronUp : faChevronDown} className={styles.urlToggleChevron} />
							</button>
							{urlSectionOpen && (
								<div className={styles.urlSection}>
									<input
										id="note-image-url"
										className={styles.input}
										value={imageUrl}
										onChange={(event) => setImageUrl(event.target.value)}
										placeholder={t('media.imageUrlPlaceholder')}
										autoFocus
									/>
									<button type="button" className={styles.secondaryButton} onClick={handleUrlSubmit} disabled={!imageUrl.trim()}>
										{t('media.addFromUrl')}
									</button>
								</div>
							)}
						</>
					)}
				</div>

				{/* Footer — always rendered above the keyboard when photos are present */}
				{(count > 0 || toastMessage) && (
					<footer className={styles.footer}>
						{toastMessage ? (
							<p className={styles.toast} role="status">{toastMessage}</p>
						) : (
							<button type="button" className={styles.primaryButton} onClick={handleFileSubmit}>
								{addLabel}
							</button>
						)}
					</footer>
				)}
			</section>
		</div>
	);
}