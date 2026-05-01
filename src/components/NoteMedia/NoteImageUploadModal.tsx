import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faChevronDown, faChevronUp, faImage, faPen, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { queueNoteImageUrlForImport, queueNoteImagesForUpload, readQueuedNoteImages, readStoredRemoteNoteImages } from '../../core/noteMediaStore';
import { applyTheme, getStoredThemeId } from '../../core/theme';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import styles from './NoteImageUploadModal.module.css';

const CAPTURE_MAX_DIMENSION_PX = 1920;
const CAPTURE_JPEG_QUALITY = 0.7;
const CAMERA_ASPECT_RATIO = 4 / 3;

type TorchTrack = MediaStreamTrack & {
	getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean };
	applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
};

type SelectedFile = {
	id: string;
	name: string;
	defaultName: string;
	previewUrl: string;
	fileName: string;
};

type DecodedImageSource = {
	width: number;
	height: number;
	draw: (context: CanvasRenderingContext2D, width: number, height: number) => void;
	release: () => void;
};

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

function replaceExtension(filename: string, extension: string): string {
	const base = stripExtension(filename).trim() || 'image';
	return `${base}${extension}`;
}

function normalizeImageName(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function createSelectionId(): string {
	return `selection:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function getNextImageDefaultName(usedNames: Set<string>): string {
	let index = 1;
	while (usedNames.has(normalizeImageName(`Image ${index}`))) {
		index += 1;
	}
	const nextName = `Image ${index}`;
	usedNames.add(normalizeImageName(nextName));
	return nextName;
}

function getPrimaryVideoTrack(stream: MediaStream | null): TorchTrack | null {
	const track = stream?.getVideoTracks?.()[0] ?? null;
	return track as TorchTrack | null;
}

function suppressNextDocumentCompatibilityMouseEvents(): void {
	if (typeof window === 'undefined') return;
	let timeoutId = 0;
	const handler = (event: MouseEvent): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	const cleanup = (): void => {
		window.removeEventListener('mousedown', handler, true);
		window.removeEventListener('mouseup', handler, true);
		window.removeEventListener('click', handler, true);
		if (timeoutId) window.clearTimeout(timeoutId);
	};
	window.addEventListener('mousedown', handler, true);
	window.addEventListener('mouseup', handler, true);
	window.addEventListener('click', handler, true);
	timeoutId = window.setTimeout(() => cleanup(), 500);
}

async function setTorchEnabled(stream: MediaStream | null, enabled: boolean): Promise<void> {
	const track = getPrimaryVideoTrack(stream);
	if (!track?.applyConstraints) {
		throw new Error('torch-unavailable');
	}
	await track.applyConstraints({
		advanced: [{ torch: enabled } as MediaTrackConstraintSet],
	} as MediaTrackConstraints);
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

async function decodeImageSource(file: Blob): Promise<DecodedImageSource> {
	if (typeof createImageBitmap === 'function') {
		try {
			const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
			return {
				width: bitmap.width || 1,
				height: bitmap.height || 1,
				draw: (context, width, height) => {
					context.drawImage(bitmap, 0, 0, width, height);
				},
				release: () => {
					bitmap.close();
				},
			};
		} catch {
			// Fall back to <img> decoding when createImageBitmap is unsupported for
			// the source codec on this browser/device.
		}
	}

	const objectUrl = URL.createObjectURL(file);
	return await new Promise<DecodedImageSource>((resolve, reject) => {
		const image = new Image();
		image.decoding = 'async';
		image.onload = () => {
			resolve({
				width: image.naturalWidth || image.width || 1,
				height: image.naturalHeight || image.height || 1,
				draw: (context, width, height) => {
					context.drawImage(image, 0, 0, width, height);
				},
				release: () => {
					image.src = '';
					URL.revokeObjectURL(objectUrl);
				},
			});
		};
		image.onerror = () => {
			image.src = '';
			URL.revokeObjectURL(objectUrl);
			reject(new Error('Image decode failed'));
		};
		image.src = objectUrl;
	});
}

async function createOptimizedImageFile(file: File): Promise<File> {
	if (typeof document === 'undefined') return file;
	const decoded = await decodeImageSource(file);
	let canvas: HTMLCanvasElement | null = null;
	try {
		const scale = Math.min(1, CAPTURE_MAX_DIMENSION_PX / Math.max(decoded.width, decoded.height, 1));
		const targetWidth = Math.max(1, Math.round(decoded.width * scale));
		const targetHeight = Math.max(1, Math.round(decoded.height * scale));
		canvas = document.createElement('canvas');
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) {
			throw new Error('Canvas context unavailable');
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, targetWidth, targetHeight);
		decoded.draw(context, targetWidth, targetHeight);
		const compressedBlob = await new Promise<Blob | null>((resolve) => {
			canvas?.toBlob(resolve, 'image/jpeg', CAPTURE_JPEG_QUALITY);
		});
		if (!compressedBlob) {
			throw new Error('Image compression failed');
		}
		return new File([compressedBlob], replaceExtension(file.name || 'image', '.jpg'), {
			type: 'image/jpeg',
			lastModified: Date.now(),
		});
	} finally {
		decoded.release();
		if (canvas) {
			canvas.width = 0;
			canvas.height = 0;
		}
	}
}

async function createCapturedPhotoFile(video: HTMLVideoElement, photoIndex: number): Promise<File> {
	const sourceWidth = Math.max(1, video.videoWidth || 0);
	const sourceHeight = Math.max(1, video.videoHeight || 0);
	if (sourceWidth <= 1 && sourceHeight <= 1) {
		throw new Error('Camera frame unavailable');
	}
	const scale = Math.min(1, CAPTURE_MAX_DIMENSION_PX / Math.max(sourceWidth, sourceHeight, 1));
	const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
	const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
	const canvas = document.createElement('canvas');
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	try {
		const context = canvas.getContext('2d', { alpha: false });
		if (!context) {
			throw new Error('Canvas context unavailable');
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, targetWidth, targetHeight);
		context.drawImage(video, 0, 0, targetWidth, targetHeight);
		const blob = await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, 'image/jpeg', CAPTURE_JPEG_QUALITY);
		});
		if (!blob) {
			throw new Error('Capture encoding failed');
		}
		return new File([blob], `photo-${photoIndex}.jpg`, {
			type: 'image/jpeg',
			lastModified: Date.now(),
		});
	} finally {
		canvas.width = 0;
		canvas.height = 0;
	}
}

async function requestCameraStream(): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('unavailable');
	}

	const attempts: MediaStreamConstraints[] = [
		{
			audio: false,
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: 2560 },
				height: { ideal: 1920 },
				aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
			},
		},
		{
			audio: false,
			video: {
				facingMode: { ideal: 'environment' },
				width: { ideal: 1920 },
				height: { ideal: 1440 },
				aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
			},
		},
		{ audio: false, video: true },
	];

	let lastError: unknown = null;
	for (const constraints of attempts) {
		try {
			return await navigator.mediaDevices.getUserMedia(constraints);
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError ?? new Error('unavailable');
}

function getCameraErrorMessage(error: unknown, t: (key: string) => string): string {
	const name = error instanceof DOMException ? error.name : '';
	if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
		return t('media.cameraPermissionDenied');
	}
	return t('media.cameraUnavailable');
}

export function NoteImageUploadModal(props: NoteImageUploadModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const fileInputRef = React.useRef<HTMLInputElement | null>(null);
	const videoRef = React.useRef<HTMLVideoElement | null>(null);
	const photoCounterRef = React.useRef(0);
	const justFocusedRef = React.useRef<number>(-1);
	const selectedFilesRef = React.useRef(new Map<string, File>());
	const selectionSessionRef = React.useRef(0);
	const cameraStreamRef = React.useRef<MediaStream | null>(null);
	const cameraRequestIdRef = React.useRef(0);

	const [selected, setSelected] = React.useState<SelectedFile[]>([]);
	const [imageUrl, setImageUrl] = React.useState('');
	const [urlSectionOpen, setUrlSectionOpen] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [isProcessingSelection, setIsProcessingSelection] = React.useState(false);
	const [isCameraOpen, setIsCameraOpen] = React.useState(false);
	const [isStartingCamera, setIsStartingCamera] = React.useState(false);
	const [isCameraReady, setIsCameraReady] = React.useState(false);
	const [isCapturingPhoto, setIsCapturingPhoto] = React.useState(false);
	const [isTorchSupported, setIsTorchSupported] = React.useState(false);
	const [isTorchEnabled, setIsTorchEnabled] = React.useState(false);
	const [isTorchBusy, setIsTorchBusy] = React.useState(false);
	const busy = isProcessingSelection || isStartingCamera || isCapturingPhoto;
	const isCameraVisible = isCameraOpen || isStartingCamera;
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	const keyboard = useKeyboardHeight();

	const detachCameraStream = React.useCallback((): void => {
		const stream = cameraStreamRef.current;
		cameraStreamRef.current = null;
		if (stream) {
			for (const track of stream.getTracks()) {
				track.stop();
			}
		}
		const video = videoRef.current;
		if (video) {
			video.pause();
			video.srcObject = null;
		}
		setIsTorchSupported(false);
		setIsTorchEnabled(false);
		setIsTorchBusy(false);
	}, []);

	const stopCameraStream = React.useCallback((): void => {
		cameraRequestIdRef.current += 1;
		detachCameraStream();
		setIsCameraOpen(false);
		setIsStartingCamera(false);
		setIsCameraReady(false);
		setIsCapturingPhoto(false);
	}, [detachCameraStream]);

	const releaseSelectedEntries = React.useCallback((entries: readonly SelectedFile[]): void => {
		for (const entry of entries) {
			URL.revokeObjectURL(entry.previewUrl);
			selectedFilesRef.current.delete(entry.id);
		}
	}, []);

	const buildUsedImageNames = React.useCallback(async (): Promise<Set<string>> => {
		const usedNames = new Set<string>();
		for (const item of selected) {
			const normalized = normalizeImageName(item.name || item.defaultName);
			if (normalized) usedNames.add(normalized);
		}
		if (!props.docId) return usedNames;
		const [remote, queued] = await Promise.all([
			readStoredRemoteNoteImages(props.docId),
			props.authUserId ? readQueuedNoteImages(props.authUserId, props.docId) : Promise.resolve([]),
		]);
		for (const image of remote) {
			const normalized = normalizeImageName(stripExtension(image.fileName || ''));
			if (normalized) usedNames.add(normalized);
		}
		for (const row of queued) {
			const normalized = normalizeImageName(stripExtension(row.fileName || ''));
			if (normalized) usedNames.add(normalized);
		}
		return usedNames;
	}, [props.authUserId, props.docId, selected]);

	const processIncomingFiles = React.useCallback(async (files: readonly File[]): Promise<void> => {
		if (files.length === 0) return;
		const sessionId = selectionSessionRef.current;
		setIsProcessingSelection(true);
		setError(null);
		const nextEntries: SelectedFile[] = [];
		let failedCount = 0;
		const usedNames = await buildUsedImageNames();

		for (const sourceFile of files) {
			try {
				const optimizedFile = await createOptimizedImageFile(sourceFile);
				if (sessionId !== selectionSessionRef.current) {
					releaseSelectedEntries(nextEntries);
					return;
				}
				photoCounterRef.current += 1;
				const id = createSelectionId();
				const defaultName = getNextImageDefaultName(usedNames);
				const previewUrl = URL.createObjectURL(optimizedFile);
				selectedFilesRef.current.set(id, optimizedFile);
				nextEntries.push({
					id,
					name: defaultName,
					defaultName,
					previewUrl,
					fileName: optimizedFile.name,
				});
			} catch {
				failedCount += 1;
			}
		}

		if (sessionId !== selectionSessionRef.current) {
			releaseSelectedEntries(nextEntries);
			return;
		}

		if (nextEntries.length > 0) {
			setSelected((prev) => [...prev, ...nextEntries]);
		}
		if (failedCount > 0) {
			setError(nextEntries.length > 0
				? 'Some photos could not be processed. The rest were optimized and added.'
				: 'Unable to process the selected photo. Try again with a smaller image.');
		}
		setIsProcessingSelection(false);
	}, [buildUsedImageNames, releaseSelectedEntries]);

	React.useEffect(() => {
		if (!props.isOpen) {
			selectionSessionRef.current += 1;
			setSelected((prev) => {
				releaseSelectedEntries(prev);
				return [];
			});
			setImageUrl('');
			setUrlSectionOpen(false);
			setError(null);
			setIsProcessingSelection(false);
			photoCounterRef.current = 0;
			stopCameraStream();
		}
	}, [props.isOpen, releaseSelectedEntries, stopCameraStream]);

	React.useEffect(() => {
		return () => {
			stopCameraStream();
		};
	}, [stopCameraStream]);

	React.useEffect(() => {
		const stream = cameraStreamRef.current;
		const video = videoRef.current;
		if (!stream || !video || !isCameraOpen) return;

		let cancelled = false;
		const markReady = (): void => {
			if (cancelled) return;
			setIsCameraReady(true);
			setIsStartingCamera(false);
		};

		video.srcObject = stream;
		video.addEventListener('loadedmetadata', markReady);
		video.addEventListener('canplay', markReady);
		if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
			markReady();
		}
		void video.play().catch(() => {
			// Some mobile browsers resolve readiness via metadata/canplay before play()
			// completes, so the event listeners remain the source of truth here.
		});

		return () => {
			cancelled = true;
			video.removeEventListener('loadedmetadata', markReady);
			video.removeEventListener('canplay', markReady);
		};
	}, [isCameraOpen]);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const themeMeta = document.querySelector('meta[name="theme-color"]');

		if (isCameraVisible) {
			themeMeta?.setAttribute('content', '#000000');
			document.body.style.backgroundColor = '#000000';
			document.documentElement.style.backgroundColor = '#000000';
		}

		return () => {
			applyTheme(getStoredThemeId());
		};
	}, [isCameraVisible]);

	if (!props.isOpen || !props.docId) return null;

	const closeAfterKeyboardSettles = (afterClose?: () => void): void => {
		const activeElement = document.activeElement;
		if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
			activeElement.blur();
			window.setTimeout(() => {
				props.onClose();
				afterClose?.();
			}, 480);
			return;
		}
		props.onClose();
		afterClose?.();
	};

	const closeFromPointerEvent = (event: React.PointerEvent<HTMLButtonElement>): void => {
		if (event.pointerType !== 'touch') return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		stopCameraStream();
		suppressNextDocumentCompatibilityMouseEvents();
		closeAfterKeyboardSettles();
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const newFiles = Array.from(event.target.files || []);
		event.target.value = '';
		if (newFiles.length > 0) {
			void processIncomingFiles(newFiles);
		}
	};

	const handleStartCamera = (): void => {
		if (isStartingCamera || isCapturingPhoto) return;
		void (async () => {
			const requestId = cameraRequestIdRef.current + 1;
			cameraRequestIdRef.current = requestId;
			setError(null);
			setIsCameraOpen(false);
			setIsStartingCamera(true);
			setIsCameraReady(false);
			setIsCapturingPhoto(false);
			try {
				detachCameraStream();
				const stream = await requestCameraStream();
				if (cameraRequestIdRef.current !== requestId) {
					for (const track of stream.getTracks()) {
						track.stop();
					}
					return;
				}
				cameraStreamRef.current = stream;
				const capabilities = getPrimaryVideoTrack(stream)?.getCapabilities?.();
				setIsTorchSupported(Boolean(capabilities?.torch));
				setIsTorchEnabled(false);
				setIsCameraOpen(true);
			} catch (cameraError) {
				if (cameraRequestIdRef.current !== requestId) return;
				stopCameraStream();
				setError(getCameraErrorMessage(cameraError, t));
			} finally {
				if (cameraRequestIdRef.current === requestId && !cameraStreamRef.current) {
					setIsStartingCamera(false);
				}
			}
		})();
	};

	const handleToggleTorch = (): void => {
		if (!cameraStreamRef.current || !isTorchSupported || isTorchBusy) return;
		void (async () => {
			setIsTorchBusy(true);
			setError(null);
			try {
				const nextEnabled = !isTorchEnabled;
				await setTorchEnabled(cameraStreamRef.current, nextEnabled);
				setIsTorchEnabled(nextEnabled);
			} catch {
				setError(t('media.cameraFlashUnavailable'));
			} finally {
				setIsTorchBusy(false);
			}
		})();
	};

	const handleCapturePhoto = (): void => {
		if (!isCameraOpen || isCapturingPhoto || isProcessingSelection) return;
		const video = videoRef.current;
		if (!video || !isCameraReady) return;
		void (async () => {
			setIsCapturingPhoto(true);
			setError(null);
			try {
				const usedNames = await buildUsedImageNames();
				photoCounterRef.current += 1;
				const capturedFile = await createCapturedPhotoFile(video, photoCounterRef.current);
				const id = createSelectionId();
				const defaultName = getNextImageDefaultName(usedNames);
				const previewUrl = URL.createObjectURL(capturedFile);
				selectedFilesRef.current.set(id, capturedFile);
				setSelected((prev) => [...prev, {
					id,
					name: defaultName,
					defaultName,
					previewUrl,
					fileName: capturedFile.name,
				}]);
				stopCameraStream();
			} catch {
				setError('Unable to capture a photo right now. Try again.');
				setIsCapturingPhoto(false);
			}
		})();
	};

	const handleRemove = (id: string): void => {
		setSelected((prev) => {
			const next = prev.filter((item) => item.id !== id);
			const removed = prev.find((item) => item.id === id);
			if (removed) {
				releaseSelectedEntries([removed]);
			}
			return next;
		});
	};

	const handleRename = (id: string, newName: string): void => {
		setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, name: newName } : item)));
		setError(null);
	};

	const handleFileSubmit = (): void => {
		if (selected.length === 0 || isProcessingSelection || isStartingCamera || isCapturingPhoto) return;
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
			const files = toSubmit.map((item) => selectedFilesRef.current.get(item.id)).filter((file): file is File => file instanceof File);
			if (files.length !== toSubmit.length) {
				setError('A processed photo is no longer available. Please add it again.');
				return;
			}
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

			setSelected((prev) => {
				releaseSelectedEntries(prev);
				return [];
			});
			setError(null);

			const fileNames = toSubmit.map((item) => {
				const ext = getExtension(item.fileName);
				const base = item.name.trim() || item.defaultName;
				return `${base}${ext}`;
			});
			await queueNoteImagesForUpload({
				userId: props.authUserId!,
				docId: props.docId!,
				files,
				fileNames,
			});
			closeAfterKeyboardSettles(() => {
				props.onUploaded?.({ queued: true, count: toSubmit.length });
			});
		})();
	};

	const handleUrlSubmit = (): void => {
		if (!imageUrl.trim() || isProcessingSelection || isStartingCamera || isCapturingPhoto) return;
		if (!props.authUserId) {
			setError(t('media.offlineRequiresAuth'));
			return;
		}
		let normalizedUrl = '';
		try {
			const parsed = new URL(imageUrl.trim());
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				setError('Enter a valid http:// or https:// image URL.');
				return;
			}
			normalizedUrl = parsed.toString();
		} catch {
			setError('Enter a valid image URL.');
			return;
		}
		setError(null);
		void queueNoteImageUrlForImport({ userId: props.authUserId, docId: props.docId!, imageUrl: normalizedUrl });
		closeAfterKeyboardSettles(() => {
			props.onUploaded?.({ queued: true, count: 1 });
		});
	};

	const count = selected.length;
	const addLabel = count === 1 ? 'Add 1 photo' : `Add ${count} photos`;

	return (
		<div className={`${styles.backdrop}${isCameraVisible ? ` ${styles.backdropCamera}` : ''}`} role="presentation">
			<section className={`${styles.dialog}${isCameraVisible ? ` ${styles.dialogCamera}` : ''}`} role="dialog" aria-modal="true" aria-busy={busy} aria-label={t('noteMenu.addImage')} onClick={(event) => event.stopPropagation()}>
				{!isCameraVisible ? (
					<header className={styles.header}>
						<div>
							<h2 className={styles.title}>{t('noteMenu.addImage')}</h2>
							<p className={styles.subtitle}>{props.noteTitle ? `${t('media.forPrefix')} ${props.noteTitle}` : t('media.attachToNote')}</p>
						</div>
						<button
							type="button"
							className={styles.close}
							onPointerUp={closeFromPointerEvent}
							onClick={() => {
								stopCameraStream();
								closeAfterKeyboardSettles();
							}}
							aria-label={t('common.close')}
						>
							<FontAwesomeIcon icon={faXmark} />
						</button>
					</header>
				) : null}

				<div className={`${styles.body}${isCameraVisible ? ` ${styles.bodyCamera}` : ''}`}>
					<input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/*" multiple onChange={handleFileChange} disabled={busy} />

					{isCameraVisible && (
						<section className={styles.cameraPanel} aria-label={t('media.takePhoto')}>
							<div className={styles.cameraViewport}>
								<video
									ref={videoRef}
									className={styles.cameraVideo}
									autoPlay
									muted
									playsInline
									onLoadedMetadata={() => {
										setIsCameraReady(true);
										setIsStartingCamera(false);
									}}
									onCanPlay={() => {
										setIsCameraReady(true);
										setIsStartingCamera(false);
									}}
								/>
								{!isCameraReady && <div className={styles.cameraPlaceholder}>{t('media.cameraStarting')}</div>}
							</div>
							{(isCapturingPhoto || isStartingCamera || !isCameraReady) ? (
								<p className={styles.cameraStatus} role="status">
									{isCapturingPhoto ? t('media.capturingPhoto') : t('media.cameraStarting')}
								</p>
							) : null}
							<div className={styles.cameraActions}>
								<button
									type="button"
									className={`${styles.cameraFab} ${styles.cameraFabCancel}`}
									onClick={stopCameraStream}
									disabled={isCapturingPhoto}
									aria-label={t('media.cancelCamera')}
								>
									<FontAwesomeIcon icon={faXmark} />
									<span className={styles.cameraFabLabel}>{t('media.cancelCamera')}</span>
								</button>
								<button type="button" className={`${styles.cameraFab} ${styles.cameraFabCapture}`} onClick={handleCapturePhoto} disabled={!isCameraReady || isCapturingPhoto || isProcessingSelection} aria-label={t('media.capturePhoto')}>
									<img className={styles.cameraCaptureIcon} src="/icons/Capture.png" alt="" aria-hidden="true" />
									<span className={styles.cameraFabLabel}>{t('media.capturePhoto')}</span>
								</button>
								<button
									type="button"
									className={`${styles.cameraFab} ${styles.cameraFabFlash}${isTorchEnabled ? ` ${styles.cameraFabActive}` : ''}`}
									onClick={handleToggleTorch}
									disabled={!isTorchSupported || isTorchBusy || isCapturingPhoto || isStartingCamera}
									aria-label={t('media.cameraFlash')}
								>
									<img className={styles.cameraSideIcon} src="/icons/Flash.png" alt="" aria-hidden="true" />
									<span className={styles.cameraFabLabel}>{t('media.cameraFlash')}</span>
								</button>
							</div>
						</section>
					)}

					{!isCameraVisible && (
						<>
							<div className={styles.actionRow}>
								<button type="button" className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`} onClick={() => fileInputRef.current?.click()} disabled={busy}>
									<FontAwesomeIcon icon={faImage} className={styles.actionIcon} />
									<span>{t('media.chooseFiles')}</span>
								</button>
								<button
									type="button"
									className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`}
									onClick={handleStartCamera}
									disabled={busy || isCameraOpen}
								>
									<FontAwesomeIcon icon={faCamera} className={styles.actionIcon} />
									<span>{t('media.takePhoto')}</span>
								</button>
							</div>
							{isProcessingSelection ? <p className={styles.processingMessage} role="status">Optimizing photos for mobile upload...</p> : null}
						</>
					)}

					{count > 0 && !isCameraVisible && (
						<ul className={styles.fileList}>
							{selected.map((item, index) => (
								<li key={item.id} className={styles.fileRow}>
									<img src={item.previewUrl} alt="" className={styles.fileThumbnail} />
									<label className={styles.fileNameWrap}>
										<FontAwesomeIcon icon={faPen} className={styles.renameIcon} aria-hidden />
										<input
											className={styles.fileNameInput}
											value={item.name}
											placeholder={item.defaultName}
											onChange={(event) => handleRename(item.id, event.target.value)}
											onFocus={(event) => {
												justFocusedRef.current = index;
												selectAllText(event.currentTarget);
											}}
											onMouseUp={(event) => {
												if (justFocusedRef.current === index) {
													event.preventDefault();
													justFocusedRef.current = -1;
												}
											}}
											aria-label={`Name for photo ${index + 1}`}
										/>
									</label>
									<button type="button" className={styles.removeButton} onClick={() => handleRemove(item.id)} disabled={busy} aria-label={`Remove photo ${index + 1}`}>
										<FontAwesomeIcon icon={faXmark} />
									</button>
								</li>
							))}
						</ul>
					)}

					{error ? <p className={styles.error}>{error}</p> : null}

					{count === 0 && !isCameraVisible && (
						<>
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
										disabled={busy}
										autoFocus
									/>
									<button type="button" className={styles.secondaryButton} onClick={handleUrlSubmit} disabled={!imageUrl.trim() || busy}>
										{t('media.addFromUrl')}
									</button>
								</div>
							)}
						</>
					)}
				</div>

				{count > 0 && !isCameraVisible && (
					<footer className={styles.footer}>
						<button type="button" className={styles.primaryButton} onClick={handleFileSubmit} disabled={busy}>
							{addLabel}
						</button>
					</footer>
				)}
			</section>
		</div>
	);
}