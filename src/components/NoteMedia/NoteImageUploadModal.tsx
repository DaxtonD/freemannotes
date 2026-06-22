import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCamera, faChevronDown, faChevronUp, faFileLines, faImage, faListCheck, faMinus, faPen, faPenNib, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { queueNoteImageUrlForImport, queueNoteImagesForUpload, readQueuedNoteImages, readStoredRemoteNoteImages } from '../../core/noteMediaStore';
import { applyTheme, getStoredThemeId } from '../../core/theme';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { useKeyboardHeight } from '../../core/useKeyboardHeight';
import styles from './NoteImageUploadModal.module.css';

const CAPTURE_MAX_DIMENSION_PX = 1920;
const CAPTURE_JPEG_QUALITY = 0.7;
const CAMERA_ASPECT_RATIO = 4 / 3;
const IMAGE_UPLOAD_BODY_FLAG = 'freemannotesNoteImageUploadOpen';

function isMoreMenuHistoryState(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	return (value as { __moreMenu?: boolean }).__moreMenu === true;
}

type CameraZoomCapability = {
	min?: number;
	max?: number;
	step?: number;
};

type AppliedCameraTrackState = {
	zoomRange: CameraZoomRange | null;
	zoomValue: number | null;
	torchSupported: boolean;
	torchEnabled: boolean;
	deviceId: string | null;
};

type RearCameraOption = {
	deviceId: string;
	label: string;
	shortLabel: string;
};

type CameraTrack = MediaStreamTrack & {
	getCapabilities?: () => MediaTrackCapabilities & { torch?: boolean; zoom?: CameraZoomCapability; focusMode?: string[] };
	getSettings?: () => MediaTrackSettings & { zoom?: number; torch?: boolean; deviceId?: string; focusMode?: string };
	applyConstraints?: (constraints: MediaTrackConstraints) => Promise<void>;
};

type CameraZoomRange = {
	min: number;
	max: number;
	step: number;
	defaultValue: number;
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
	noteType?: 'text' | 'checklist' | 'drawing';
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

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, min: number, max: number, step: number): number {
	const normalizedStep = step > 0 ? step : 1;
	const next = min + Math.round((value - min) / normalizedStep) * normalizedStep;
	return clampNumber(next, min, max);
}

function getZoomPrecision(step: number): number {
	if (step >= 1) return 0;
	if (step >= 0.1) return 1;
	return 2;
}

function getPrimaryVideoTrack(stream: MediaStream | null): CameraTrack | null {
	const track = stream?.getVideoTracks?.()[0] ?? null;
	return track as CameraTrack | null;
}

function getCameraCapabilities(track: CameraTrack | null): ReturnType<NonNullable<CameraTrack['getCapabilities']>> | null {
	// Optional chaining on the DOM type narrows back to MediaTrackCapabilities, so
	// keep the custom torch/zoom/focus fields behind one typed helper.
	return track?.getCapabilities?.() ?? null;
}

function getCameraZoomRange(track: CameraTrack | null): CameraZoomRange | null {
	const capability = getCameraCapabilities(track)?.zoom;
	const min = capability?.min;
	const max = capability?.max;
	if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
		return null;
	}
	const capabilityStep = capability?.step;
	const step = typeof capabilityStep === 'number' && Number.isFinite(capabilityStep) && capabilityStep > 0
		? capabilityStep
		: Math.max((max - min) / 20, 0.1);
	const currentZoom = track?.getSettings?.().zoom;
	const defaultValue = roundToStep(typeof currentZoom === 'number' && Number.isFinite(currentZoom) ? currentZoom : min, min, max, step);
	return {
		min,
		max,
		step,
		defaultValue,
	};
}

function readCameraTrackState(track: CameraTrack | null): AppliedCameraTrackState {
	const zoomRange = getCameraZoomRange(track);
	const settings = track?.getSettings?.();
	const capabilities = getCameraCapabilities(track);
	const zoomValue = zoomRange && typeof settings?.zoom === 'number' && Number.isFinite(settings.zoom)
		? clampNumber(settings.zoom, zoomRange.min, zoomRange.max)
		: zoomRange?.defaultValue ?? null;
	return {
		zoomRange,
		zoomValue,
		torchSupported: Boolean(capabilities?.torch),
		torchEnabled: Boolean(settings?.torch),
		deviceId: settings?.deviceId ?? null,
	};
}

function getContinuousFocusMode(track: CameraTrack | null): string | null {
	const focusModes = getCameraCapabilities(track)?.focusMode;
	if (!Array.isArray(focusModes)) return null;
	for (const focusMode of focusModes) {
		if (typeof focusMode === 'string' && focusMode.toLowerCase() === 'continuous') {
			return focusMode;
		}
	}
	return null;
}

function isLikelyFrontCameraLabel(label: string): boolean {
	return /\b(front|user|selfie|facetime)\b/i.test(label);
}

function isLikelyRearCameraLabel(label: string): boolean {
	return /\b(back|rear|environment|world|ultra|tele|periscope|macro)\b/i.test(label);
}

function getRearCameraShortLabel(label: string, index: number): string {
	const numericMatch = label.match(/(\d+(?:\.\d+)?)\s*x\b/i);
	if (numericMatch?.[1]) {
		return `${numericMatch[1]}x`;
	}
	const lower = label.toLowerCase();
	if (lower.includes('ultra')) return '0.6x';
	if (lower.includes('tele') || lower.includes('periscope')) return 'Tele';
	if (lower.includes('macro')) return 'Macro';
	if (lower.includes('wide')) return 'Wide';
	return index === 0 ? '1x' : `Lens ${index + 1}`;
}

function getRearCameraOptions(devices: MediaDeviceInfo[], activeDeviceId: string | null, activeLabel: string): RearCameraOption[] {
	// Many Android devices expose ultrawide and telephoto lenses as separate rear
	// cameras rather than as one camera with a larger zoom range.
	const videoInputs = devices.filter((device) => device.kind === 'videoinput');
	const explicitRear = videoInputs.filter((device) => isLikelyRearCameraLabel(device.label));
	const rearCandidates = (explicitRear.length > 0 ? explicitRear : videoInputs.filter((device) => !isLikelyFrontCameraLabel(device.label))).slice();
	if (activeDeviceId && !rearCandidates.some((device) => device.deviceId === activeDeviceId)) {
		rearCandidates.unshift({
			deviceId: activeDeviceId,
			groupId: '',
			kind: 'videoinput',
			label: activeLabel || 'Rear camera',
			toJSON: () => ({}),
		});
	}
	const seen = new Set<string>();
	const uniqueCandidates = rearCandidates.filter((device) => {
		if (!device.deviceId || seen.has(device.deviceId)) return false;
		seen.add(device.deviceId);
		return true;
	});
	return uniqueCandidates.map((device, index) => ({
		deviceId: device.deviceId,
		label: device.label || (device.deviceId === activeDeviceId && activeLabel ? activeLabel : `Rear camera ${index + 1}`),
		shortLabel: getRearCameraShortLabel(device.label || activeLabel || '', index),
	}));
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

async function applyCameraTrackSettings(stream: MediaStream | null, options: { zoom?: number; torch?: boolean }): Promise<AppliedCameraTrackState> {
	const track = getPrimaryVideoTrack(stream);
	if (!track) {
		throw new Error('camera-unavailable');
	}
	// applyConstraints() replaces the current custom constraint set, so merge zoom,
	// torch, and continuous focus into one update to preserve autofocus.
	const zoomRange = getCameraZoomRange(track);
	const settings = track.getSettings?.();
	const advanced: Record<string, unknown> = {};
	if (zoomRange) {
		const baseZoom = typeof options.zoom === 'number'
			? options.zoom
			: (typeof settings?.zoom === 'number' && Number.isFinite(settings.zoom) ? settings.zoom : zoomRange.defaultValue);
		advanced.zoom = roundToStep(baseZoom, zoomRange.min, zoomRange.max, zoomRange.step);
	}
	if (getCameraCapabilities(track)?.torch) {
		advanced.torch = typeof options.torch === 'boolean'
			? options.torch
			: (typeof settings?.torch === 'boolean' ? settings.torch : false);
	}
	const continuousFocusMode = getContinuousFocusMode(track);
	if (continuousFocusMode) {
		advanced.focusMode = continuousFocusMode;
	}
	if (track.applyConstraints && Object.keys(advanced).length > 0) {
		await track.applyConstraints({
			advanced: [advanced as MediaTrackConstraintSet],
		} as MediaTrackConstraints);
	}
	return readCameraTrackState(track);
}

async function setCameraZoom(stream: MediaStream | null, requestedValue: number): Promise<number> {
	const track = getPrimaryVideoTrack(stream);
	const zoomRange = getCameraZoomRange(track);
	if (!track || !zoomRange) {
		throw new Error('zoom-unavailable');
	}
	const nextValue = roundToStep(requestedValue, zoomRange.min, zoomRange.max, zoomRange.step);
	const nextState = await applyCameraTrackSettings(stream, { zoom: nextValue });
	return nextState.zoomValue ?? nextValue;
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

async function requestCameraStream(preferredDeviceId?: string | null): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('unavailable');
	}

	const preferredDeviceAttempts: MediaStreamConstraints[] = preferredDeviceId ? [
		{
			audio: false,
			video: {
				deviceId: { exact: preferredDeviceId },
				width: { ideal: 2560 },
				height: { ideal: 1920 },
				aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
			},
		},
		{
			audio: false,
			video: {
				deviceId: { exact: preferredDeviceId },
				width: { ideal: 1920 },
				height: { ideal: 1440 },
				aspectRatio: { ideal: CAMERA_ASPECT_RATIO },
			},
		},
		{
			audio: false,
			video: {
				deviceId: { exact: preferredDeviceId },
			},
		},
	] : [];

	const defaultAttempts: MediaStreamConstraints[] = [
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
	const attempts = [...preferredDeviceAttempts, ...defaultAttempts];

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
	const cameraZoomRequestIdRef = React.useRef(0);
	const historyTokenRef = React.useRef(`note-image-upload:${Math.random().toString(36).slice(2, 10)}`);

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
	const [cameraZoomRange, setCameraZoomRange] = React.useState<CameraZoomRange | null>(null);
	const [cameraZoomValue, setCameraZoomValue] = React.useState<number | null>(null);
	const [rearCameraOptions, setRearCameraOptions] = React.useState<RearCameraOption[]>([]);
	const [selectedCameraDeviceId, setSelectedCameraDeviceId] = React.useState<string | null>(null);
	const [isZoomBusy, setIsZoomBusy] = React.useState(false);
	const [confirmationMessage, setConfirmationMessage] = React.useState<string | null>(null);
	const confirmationTimeoutRef = React.useRef<number | null>(null);
	const busy = isProcessingSelection || isStartingCamera || isCapturingPhoto;
	const isCameraVisible = isCameraOpen || isStartingCamera;
	const isCoarsePointer = useIsCoarsePointer();
	useBodyScrollLock(props.isOpen, { disableTouchAction: false });
	const keyboard = useKeyboardHeight();

	const detachCameraStream = React.useCallback((): void => {
		const stream = cameraStreamRef.current;
		cameraZoomRequestIdRef.current += 1;
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
		setCameraZoomRange(null);
		setCameraZoomValue(null);
		setIsZoomBusy(false);
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

	const syncRearCameraOptions = async (track: CameraTrack | null): Promise<void> => {
		const activeDeviceId = track?.getSettings?.().deviceId ?? null;
		const activeLabel = track?.label ?? '';
		if (!navigator.mediaDevices?.enumerateDevices) {
			if (activeDeviceId) {
				setRearCameraOptions([{ deviceId: activeDeviceId, label: activeLabel || 'Rear camera', shortLabel: '1x' }]);
				setSelectedCameraDeviceId(activeDeviceId);
			}
			return;
		}
		try {
			const options = getRearCameraOptions(await navigator.mediaDevices.enumerateDevices(), activeDeviceId, activeLabel);
			setRearCameraOptions(options);
			if (activeDeviceId) {
				setSelectedCameraDeviceId(activeDeviceId);
			}
		} catch {
			if (activeDeviceId) {
				setRearCameraOptions([{ deviceId: activeDeviceId, label: activeLabel || 'Rear camera', shortLabel: '1x' }]);
				setSelectedCameraDeviceId(activeDeviceId);
			}
		}
	};

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
			setConfirmationMessage(null);
			if (confirmationTimeoutRef.current !== null) {
				window.clearTimeout(confirmationTimeoutRef.current);
				confirmationTimeoutRef.current = null;
			}
		}
	}, [props.isOpen, releaseSelectedEntries, stopCameraStream]);

	React.useEffect(() => {
		return () => {
			stopCameraStream();
		};
	}, [stopCameraStream]);

	React.useEffect(() => {
		if (!props.isOpen || !isCoarsePointer || typeof window === 'undefined') return;
		let active = true;
		const ownsHistoryEntryRef = { current: false };
		const token = historyTokenRef.current;
		const onPopState = (): void => {
			if (!active) return;
			const state = window.history.state as { __noteImageUpload?: string } | null;
			if (state?.__noteImageUpload === token) return;
			stopCameraStream();
			props.onClose();
		};
		window.addEventListener('popstate', onPopState);
		const pushTimer = window.setTimeout(() => {
			if (!active) return;
			const currentState = window.history.state;
			if (isMoreMenuHistoryState(currentState)) {
				window.history.replaceState({ __noteImageUpload: token }, '');
				ownsHistoryEntryRef.current = true;
				return;
			}
			if ((currentState as { __noteImageUpload?: string } | null)?.__noteImageUpload !== token) {
				window.history.pushState({ __noteImageUpload: token }, '');
				ownsHistoryEntryRef.current = true;
			}
		}, 0);
		return () => {
			active = false;
			window.clearTimeout(pushTimer);
			window.removeEventListener('popstate', onPopState);
			if (!ownsHistoryEntryRef.current) return;
			window.setTimeout(() => {
				const state = window.history.state as { __noteImageUpload?: string } | null;
				if (state?.__noteImageUpload === token) {
					window.history.back();
				}
			}, 0);
		};
	}, [isCoarsePointer, props.isOpen, props.onClose, stopCameraStream]);

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

	React.useEffect(() => {
		if (!props.isOpen || typeof document === 'undefined') return;
		document.body.dataset[IMAGE_UPLOAD_BODY_FLAG] = 'true';
		return () => {
			delete document.body.dataset[IMAGE_UPLOAD_BODY_FLAG];
		};
	}, [props.isOpen]);

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

	const requestClose = (afterClose?: () => void): void => {
		stopCameraStream();
		closeAfterKeyboardSettles(() => {
			if (
				isCoarsePointer
				&& typeof window !== 'undefined'
				&& (window.history.state as { __noteImageUpload?: string } | null)?.__noteImageUpload === historyTokenRef.current
			) {
				window.history.back();
				afterClose?.();
				return;
			}
			props.onClose();
			afterClose?.();
		});
	};

	const closeFromPointerEvent = (event: React.PointerEvent<HTMLButtonElement>): void => {
		if (event.pointerType !== 'touch') return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		suppressNextDocumentCompatibilityMouseEvents();
		requestClose();
	};

	const closeFromTouchEvent = (event: React.TouchEvent<HTMLButtonElement>): void => {
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		suppressNextDocumentCompatibilityMouseEvents();
		requestClose();
	};

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const newFiles = Array.from(event.target.files || []);
		event.target.value = '';
		if (newFiles.length > 0) {
			void processIncomingFiles(newFiles);
		}
	};

	const handleStartCamera = (preferredDeviceId?: string | null): void => {
		if (isStartingCamera || isCapturingPhoto) return;
		void (async () => {
			const requestedDeviceId = preferredDeviceId ?? selectedCameraDeviceId;
			const requestId = cameraRequestIdRef.current + 1;
			cameraRequestIdRef.current = requestId;
			setError(null);
			setIsCameraOpen(false);
			setIsStartingCamera(true);
			setIsCameraReady(false);
			setIsCapturingPhoto(false);
			try {
				detachCameraStream();
				const stream = await requestCameraStream(requestedDeviceId);
				if (cameraRequestIdRef.current !== requestId) {
					for (const track of stream.getTracks()) {
						track.stop();
					}
					return;
				}
				cameraStreamRef.current = stream;
				const track = getPrimaryVideoTrack(stream);
				let nextState = readCameraTrackState(track);
				try {
					nextState = await applyCameraTrackSettings(stream, {});
				} catch {
					// Keep the live stream even if optional focus normalization fails.
				}
				setIsTorchSupported(nextState.torchSupported);
				setIsTorchEnabled(nextState.torchEnabled);
				setCameraZoomRange(nextState.zoomRange);
				setCameraZoomValue(nextState.zoomValue);
				setSelectedCameraDeviceId(nextState.deviceId ?? requestedDeviceId ?? null);
				await syncRearCameraOptions(track);
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
				const nextState = await applyCameraTrackSettings(cameraStreamRef.current, { torch: !isTorchEnabled });
				setIsTorchEnabled(nextState.torchEnabled);
				setCameraZoomRange(nextState.zoomRange);
				setCameraZoomValue(nextState.zoomValue);
			} catch {
				setError(t('media.cameraFlashUnavailable'));
			} finally {
				setIsTorchBusy(false);
			}
		})();
	};

	const handleSetZoom = (requestedValue: number): void => {
		if (!cameraStreamRef.current || !cameraZoomRange) return;
		const nextRequestId = cameraZoomRequestIdRef.current + 1;
		cameraZoomRequestIdRef.current = nextRequestId;
		const nextValue = roundToStep(requestedValue, cameraZoomRange.min, cameraZoomRange.max, cameraZoomRange.step);
		setCameraZoomValue(nextValue);
		setError(null);
		setIsZoomBusy(true);
		void (async () => {
			try {
				const appliedValue = await setCameraZoom(cameraStreamRef.current, nextValue);
				if (cameraZoomRequestIdRef.current !== nextRequestId) return;
				setCameraZoomValue(appliedValue);
				setIsTorchEnabled(Boolean(getPrimaryVideoTrack(cameraStreamRef.current)?.getSettings?.().torch));
			} catch {
				if (cameraZoomRequestIdRef.current !== nextRequestId) return;
				setCameraZoomRange(null);
				setCameraZoomValue(null);
				setError(t('media.cameraZoomUnavailable'));
			} finally {
				if (cameraZoomRequestIdRef.current === nextRequestId) {
					setIsZoomBusy(false);
				}
			}
		})();
	};

	const handleZoomStep = (direction: -1 | 1): void => {
		if (!cameraZoomRange) return;
		handleSetZoom((cameraZoomValue ?? cameraZoomRange.defaultValue) + direction * cameraZoomRange.step);
	};

	const handleResetZoom = (): void => {
		if (!cameraZoomRange) return;
		handleSetZoom(cameraZoomRange.defaultValue);
	};

	const handleSelectRearCamera = (deviceId: string): void => {
		if (busy) return;
		if (isCameraOpen && selectedCameraDeviceId === deviceId) return;
		setSelectedCameraDeviceId(deviceId);
		handleStartCamera(deviceId);
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

			const uploadCount = toSubmit.length;
			const fileNames = toSubmit.map((item) => {
				const ext = getExtension(item.fileName);
				const base = item.name.trim() || item.defaultName;
				return `${base}${ext}`;
			});

			// Clear selection and show confirmation immediately — before the async
			// IDB write so the user gets instant feedback regardless of queue speed.
			setSelected((prev) => {
				releaseSelectedEntries(prev);
				return [];
			});
			setError(null);
			const noteName = props.noteTitle;
			const confirmMsg = noteName
				? `${uploadCount} ${uploadCount === 1 ? 'photo' : 'photos'} added to ${noteName}`
				: `${uploadCount} ${uploadCount === 1 ? 'photo' : 'photos'} added`;
			if (confirmationTimeoutRef.current !== null) window.clearTimeout(confirmationTimeoutRef.current);
			setConfirmationMessage(confirmMsg);
			confirmationTimeoutRef.current = window.setTimeout(() => {
				confirmationTimeoutRef.current = null;
				setConfirmationMessage(null);
			}, 4000);
			const activeEl = document.activeElement;
			if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) activeEl.blur();

			try {
				await queueNoteImagesForUpload({
					userId: props.authUserId!,
					docId: props.docId!,
					files,
					fileNames,
				});
				props.onUploaded?.({ queued: true, count: uploadCount });
			} catch {
				setError('Failed to save photos. Please try again.');
				setConfirmationMessage(null);
				if (confirmationTimeoutRef.current !== null) {
					window.clearTimeout(confirmationTimeoutRef.current);
					confirmationTimeoutRef.current = null;
				}
			}
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
		setImageUrl('');
		setUrlSectionOpen(false);
		const urlNoteName = props.noteTitle;
		const urlConfirmMsg = urlNoteName ? `Image URL added to ${urlNoteName}` : 'Image URL added';
		if (confirmationTimeoutRef.current !== null) window.clearTimeout(confirmationTimeoutRef.current);
		setConfirmationMessage(urlConfirmMsg);
		confirmationTimeoutRef.current = window.setTimeout(() => {
			confirmationTimeoutRef.current = null;
			setConfirmationMessage(null);
		}, 4000);
		const activeEl = document.activeElement;
		if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) activeEl.blur();
		props.onUploaded?.({ queued: true, count: 1 });
	};

	const count = selected.length;
	const addLabel = count === 1 ? 'Add 1 photo' : `Add ${count} photos`;
	const zoomValueLabel = cameraZoomRange && cameraZoomValue !== null
		? `${cameraZoomValue.toFixed(getZoomPrecision(cameraZoomRange.step))}x`
		: null;
	const isZoomActive = cameraZoomRange !== null
		&& cameraZoomValue !== null
		&& Math.abs(cameraZoomValue - cameraZoomRange.defaultValue) > Math.max(cameraZoomRange.step / 2, 0.01);
	const showRearCameraOptions = rearCameraOptions.length > 1;
	const showCameraTopControls = showRearCameraOptions || Boolean(cameraZoomRange && zoomValueLabel);

	return (
		<div className={`${styles.backdrop}${isCameraVisible ? ` ${styles.backdropCamera}` : ''}`} role="presentation">
			<section className={`${styles.dialog}${isCameraVisible ? ` ${styles.dialogCamera}` : ''}`} role="dialog" aria-modal="true" aria-busy={busy} aria-label={t('noteMenu.addImage')} onClick={(event) => event.stopPropagation()}>
				{!isCameraVisible ? (
					<header className={styles.header}>
						<div>
							<h2 className={styles.title}>{t('noteMenu.addImage')}</h2>
							<p className={styles.subtitle}>
								<FontAwesomeIcon
									icon={props.noteType === 'checklist' ? faListCheck : props.noteType === 'drawing' ? faPenNib : faFileLines}
									className={styles.subtitleIcon}
								/>
								{`${props.noteType === 'checklist' ? 'Checklist' : props.noteType === 'drawing' ? 'Drawing' : 'Note'}: ${props.noteTitle || '(untitled)'}`}
							</p>
						</div>
						<button
							type="button"
							className={styles.close}
							onPointerUp={closeFromPointerEvent}
							onTouchEnd={closeFromTouchEvent}
							onClick={() => {
								requestClose();
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
							{showCameraTopControls ? (
								<div className={styles.cameraTopControls}>
									{showRearCameraOptions ? (
										<div className={styles.cameraLensStrip} role="group" aria-label={t('media.cameraLenses')}>
											{rearCameraOptions.map((option) => (
												<button
													key={option.deviceId}
													type="button"
													className={`${styles.cameraLensButton}${selectedCameraDeviceId === option.deviceId ? ` ${styles.cameraLensButtonActive}` : ''}`}
													onClick={() => handleSelectRearCamera(option.deviceId)}
													disabled={busy}
													aria-pressed={selectedCameraDeviceId === option.deviceId}
													title={option.label}
												>
													{option.shortLabel}
												</button>
											))}
										</div>
									) : null}
									{cameraZoomRange && zoomValueLabel ? (
										<div className={styles.cameraZoomControls} role="group" aria-label={t('media.cameraZoom')}>
											<button
												type="button"
												className={styles.cameraZoomButton}
												onClick={() => handleZoomStep(-1)}
												disabled={!isCameraReady || isCapturingPhoto || isStartingCamera || isZoomBusy || cameraZoomValue === null || cameraZoomValue <= cameraZoomRange.min}
												aria-label={t('media.zoomOut')}
											>
												<FontAwesomeIcon icon={faMinus} />
											</button>
											<input
												type="range"
												className={styles.cameraZoomSlider}
												min={cameraZoomRange.min}
												max={cameraZoomRange.max}
												step={cameraZoomRange.step}
												value={cameraZoomValue ?? cameraZoomRange.defaultValue}
												onChange={(event) => handleSetZoom(Number(event.currentTarget.value))}
												disabled={!isCameraReady || isCapturingPhoto || isStartingCamera}
												aria-label={t('media.cameraZoom')}
											/>
											<button
												type="button"
												className={styles.cameraZoomValue}
												onClick={handleResetZoom}
												disabled={!isCameraReady || isCapturingPhoto || isStartingCamera || isZoomBusy || !isZoomActive}
												aria-label={t('media.resetZoom')}
											>
												{zoomValueLabel}
											</button>
											<button
												type="button"
												className={styles.cameraZoomButton}
												onClick={() => handleZoomStep(1)}
												disabled={!isCameraReady || isCapturingPhoto || isStartingCamera || isZoomBusy || cameraZoomValue === null || cameraZoomValue >= cameraZoomRange.max}
												aria-label={t('media.zoomIn')}
											>
												<FontAwesomeIcon icon={faPlus} />
											</button>
										</div>
									) : null}
								</div>
							) : null}
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
									{/* Keep these controls network-independent so camera actions remain visible offline. */}
									<img src="/icons/Capture.png" className={styles.cameraCaptureIcon} aria-hidden="true" alt="" />
									<span className={styles.cameraFabLabel}>{t('media.capturePhoto')}</span>
								</button>
								<button
									type="button"
									className={`${styles.cameraFab} ${styles.cameraFabFlash}${isTorchEnabled ? ` ${styles.cameraFabActive}` : ''}`}
									onClick={handleToggleTorch}
									disabled={!isTorchSupported || isTorchBusy || isCapturingPhoto || isStartingCamera}
									aria-label={t('media.cameraFlash')}
								>
									<svg className={styles.cameraSideIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
										<path d="M13.5 2L6 13h4.5l-1 9L18 11h-4.5L13.5 2z" fill="currentColor" />
									</svg>
									<span className={styles.cameraFabLabel}>{t('media.cameraFlash')}</span>
								</button>
							</div>
						</section>
					)}

					{!isCameraVisible && (
						<>
							{confirmationMessage ? (
								<div className={styles.confirmationBanner} role="status">
									{confirmationMessage}
								</div>
							) : null}
							<div className={styles.actionRow}>
								<button type="button" className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`} onClick={() => fileInputRef.current?.click()} disabled={busy}>
									<FontAwesomeIcon icon={faImage} className={styles.actionIcon} />
									<span>{t('media.chooseFiles')}</span>
								</button>
								<button
									type="button"
									className={`${styles.actionButton}${keyboard.isOpen ? ` ${styles.actionButtonCompact}` : ''}`}
									onClick={() => handleStartCamera()}
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