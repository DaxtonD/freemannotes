import React from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowsRotate, faBolt, faCamera, faCheck, faChevronLeft, faChevronRight, faPlus, faRotateRight, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../../core/i18n';
import {
	applyScanFilter,
	detectDocumentQuad,
	quadOutputSize,
	scaleQuad,
	toGrayscale,
	warpQuadToRectangle,
	DEFAULT_SCAN_ADJUSTMENTS,
	type Point,
	type Quad,
	type RgbaImage,
	type ScanAdjustments,
	type ScanFilter,
} from './documentScan';
import {
	createCapturedPhotoFile,
	getCameraErrorMessage,
	getPrimaryVideoTrack,
	readCameraTrackState,
	requestCameraStream,
	setCameraZoom,
	applyCameraTrackSettings,
	type CameraZoomRange,
} from '../../NoteMedia/NoteImageUploadModal';
import { buildScanPdf, type ScanPageImage } from './scanPdf';
import styles from './ScanModal.module.css';

// Photograph a page, straighten it, clean it up, repeat, then save the lot as one PDF on the note.
// The camera is the app's own (the same engine as taking a photo for a note: full-resolution stills
// through ImageCapture, zoom, torch), so the shutter looks and behaves the same everywhere. Handing
// off to the system camera app instead used to leave this page holding so much memory that Android
// killed the camera with a low-memory error. Picking an existing image still works as a fallback.
//
// One thing at a time: shoot, then crop, then clean up, then the pages you've got. A single long
// panel meant scrolling past the photo to reach a slider, which is miserable on a phone.

// Memory is the whole ball game here. A phone camera hands back a 12-megapixel photo, and every
// full-size copy of it is ~48 MB of pixels; holding a few at once was enough for Android to start
// killing the camera app itself with a low-memory error the next time it was opened. So: decode
// straight down to working size, keep exactly one copy, and hand canvases back when done.
const DETECTION_SIDE = 560;
const PREVIEW_SIDE = 900;
const JPEG_QUALITY = 0.86;

/** Working resolution: ~150 dpi for an A4 page, more on a desktop with memory to spare. */
function maxWorkingSide(): number {
	if (typeof navigator === 'undefined') return 1700;
	const memory = (navigator as { deviceMemory?: number }).deviceMemory;
	const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
	if (!coarse && (memory === undefined || memory >= 8)) return 2200;
	if (memory !== undefined && memory <= 4) return 1500;
	return 1700;
}

type ScanStep = 'capture' | 'crop' | 'clean' | 'pages';

type ScanPage = ScanPageImage & {
	id: string;
	previewUrl: string;
};

type Draft = {
	/** The photo, at working resolution. */
	image: RgbaImage;
	previewUrl: string;
	quad: Quad;
	detected: boolean;
	adjustments: ScanAdjustments;
};

type ScanModalProps = {
	onClose: () => void;
	onSave: (file: File) => Promise<void> | void;
	defaultTitle?: string;
};

function canvasFor(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

/** Hands a canvas's pixels back now rather than whenever the collector gets round to it. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
	canvas.width = 0;
	canvas.height = 0;
}

function imageDataToBlob(image: RgbaImage, quality = JPEG_QUALITY): Promise<Blob> {
	const canvas = canvasFor(image.width, image.height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('This browser will not give us a canvas to work on');
	// Copied into a fresh array: ImageData insists on owning a plain buffer.
	context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			releaseCanvas(canvas);
			if (blob) resolve(blob);
			else reject(new Error('The page could not be encoded'));
		}, 'image/jpeg', quality);
	});
}

function drawToImageData(source: ImageBitmap, width: number, height: number): RgbaImage {
	const canvas = canvasFor(width, height);
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('This browser will not give us a canvas to work on');
	context.drawImage(source, 0, 0, width, height);
	const data = context.getImageData(0, 0, width, height);
	releaseCanvas(canvas);
	return { data: data.data, width, height };
}

/**
 * Decodes the photo already scaled down. Passing resize options to createImageBitmap lets the
 * browser do it while decoding, so the full-size picture never exists in our memory at all — which
 * is the difference between a scan working on a phone and the camera dying of it.
 */
async function decodePhoto(file: File, maxSide: number): Promise<ImageBitmap> {
	try {
		const probe = await createImageBitmap(file, { resizeQuality: 'high' } as ImageBitmapOptions);
		const scale = Math.min(1, maxSide / Math.max(probe.width, probe.height));
		if (scale >= 1) return probe;
		const resizeWidth = Math.max(1, Math.round(probe.width * scale));
		const resizeHeight = Math.max(1, Math.round(probe.height * scale));
		probe.close?.();
		return await createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' } as ImageBitmapOptions);
	} catch {
		// Older browsers ignore the options or refuse them; fall back to a plain decode.
		return createImageBitmap(file);
	}
}

/** Rotates a photo a quarter turn, for pages that came out sideways. */
function rotateImage(image: RgbaImage): RgbaImage {
	const { data, width, height } = image;
	const output = new Uint8ClampedArray(data.length);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const from = (y * width + x) * 4;
			// (x, y) → (height - 1 - y, x) in the rotated image, whose width is the old height.
			const to = (x * height + (height - 1 - y)) * 4;
			output[to] = data[from];
			output[to + 1] = data[from + 1];
			output[to + 2] = data[from + 2];
			output[to + 3] = data[from + 3];
		}
	}
	return { data: output, width: height, height: width };
}

/**
 * The scanner is drawn at the page root, but React still bubbles its events up through whatever
 * opened it — the attachments sheet, the note editor. A scroll or a drag on a slider counted as a
 * gesture on the sheet, which closed and took the scanner down with it. Nothing in here is anyone
 * else's business.
 */
const stopEvent = (event: React.SyntheticEvent): void => event.stopPropagation();

export function ScanModal(props: ScanModalProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [pages, setPages] = React.useState<readonly ScanPage[]>([]);
	const [draft, setDraft] = React.useState<Draft | null>(null);
	const [step, setStep] = React.useState<ScanStep>('capture');
	const [title, setTitle] = React.useState(props.defaultTitle || '');
	const [busy, setBusy] = React.useState<'reading' | 'working' | 'saving' | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
	const [draggingCorner, setDraggingCorner] = React.useState<number | null>(null);
	const [stream, setStream] = React.useState<MediaStream | null>(null);
	const [cameraReady, setCameraReady] = React.useState(false);
	const [cameraBlocked, setCameraBlocked] = React.useState(false);
	const [zoomRange, setZoomRange] = React.useState<CameraZoomRange | null>(null);
	const [zoomValue, setZoomValue] = React.useState<number | null>(null);
	const [torchOn, setTorchOn] = React.useState(false);
	const [torchSupported, setTorchSupported] = React.useState(false);
	const videoRef = React.useRef<HTMLVideoElement | null>(null);
	const streamRef = React.useRef<MediaStream | null>(null);
	streamRef.current = stream;
	const inputRef = React.useRef<HTMLInputElement | null>(null);
	const frameRef = React.useRef<HTMLDivElement | null>(null);
	const previewTokenRef = React.useRef(0);
	const pagesRef = React.useRef<readonly ScanPage[]>([]);
	pagesRef.current = pages;
	const isCoarsePointer = React.useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, []);

	React.useEffect(() => () => {
		// Object URLs outlive the component unless they're let go of.
		for (const page of pagesRef.current) URL.revokeObjectURL(page.previewUrl);
	}, []);

	React.useEffect(() => () => {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
	}, [previewUrl]);

	// What the finished page will look like, redrawn (smaller) whenever the clean-up settings change.
	// Only on the clean-up step: there's no point paying for it while the corners are being dragged.
	React.useEffect(() => {
		if (!draft || step !== 'clean') return undefined;
		const token = previewTokenRef.current + 1;
		previewTokenRef.current = token;
		const timer = window.setTimeout(() => {
			void (async () => {
				try {
					const size = quadOutputSize(draft.quad, PREVIEW_SIDE);
					const warped = warpQuadToRectangle(draft.image, draft.quad, size.width, size.height);
					const cleaned = applyScanFilter(warped, draft.adjustments);
					const blob = await imageDataToBlob(cleaned, 0.8);
					if (previewTokenRef.current !== token) return;
					setPreviewUrl((current) => {
						if (current) URL.revokeObjectURL(current);
						return URL.createObjectURL(blob);
					});
				} catch (previewError) {
					console.error('[scan] preview failed', previewError);
				}
			})();
		}, 120);
		return () => window.clearTimeout(timer);
	}, [draft, step]);

	const discardDraft = React.useCallback((): void => {
		setDraft((current) => {
			if (current) URL.revokeObjectURL(current.previewUrl);
			return null;
		});
		setPreviewUrl((current) => {
			if (current) URL.revokeObjectURL(current);
			return null;
		});
	}, []);

	const ingestPhoto = async (file: File): Promise<void> => {
		setBusy('reading');
		setError(null);
		try {
			const bitmap = await decodePhoto(file, maxWorkingSide());
			const image = drawToImageData(bitmap, bitmap.width, bitmap.height);
			// Edges are found on a small copy, drawn from the same decoded photo rather than by
			// copying the working image again: faster, and one fewer picture in memory at once.
			const detectScale = Math.min(1, DETECTION_SIDE / Math.max(bitmap.width, bitmap.height));
			const small = drawToImageData(bitmap, Math.max(8, Math.round(bitmap.width * detectScale)), Math.max(8, Math.round(bitmap.height * detectScale)));
			bitmap.close?.();
			const found = detectDocumentQuad(toGrayscale(small));
			const quad = scaleQuad(found.quad, image.width / small.width, image.height / small.height);
			const photoBlob = await imageDataToBlob(image, 0.9);
			setDraft({ image, previewUrl: URL.createObjectURL(photoBlob), quad, detected: found.detected, adjustments: DEFAULT_SCAN_ADJUSTMENTS });
			setStep('crop');
		} catch (readError) {
			console.error('[scan] could not read that photo', readError);
			setError(t('scan.photoFailed'));
		} finally {
			setBusy(null);
		}
	};

	const handlePhotoChosen = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
		const file = (event.target.files || [])[0];
		event.target.value = '';
		if (file) await ingestPhoto(file);
	};

	// The camera runs only while the capture step is on screen: a live stream is expensive, and
	// leaving one running behind the crop and clean-up steps is what makes phones feel hot.
	const stopCamera = React.useCallback((): void => {
		const current = streamRef.current;
		if (current) for (const track of current.getTracks()) track.stop();
		streamRef.current = null;
		setStream(null);
		setCameraReady(false);
		setTorchOn(false);
	}, []);

	React.useEffect(() => {
		if (step !== 'capture' || cameraBlocked) {
			stopCamera();
			return undefined;
		}
		let cancelled = false;
		void (async () => {
			try {
				const opened = await requestCameraStream();
				if (cancelled) {
					for (const track of opened.getTracks()) track.stop();
					return;
				}
				setStream(opened);
				// Same reading of the camera's capabilities the photo camera does.
				const state = readCameraTrackState(getPrimaryVideoTrack(opened));
				setZoomRange(state.zoomRange);
				setZoomValue(state.zoomValue);
				setTorchSupported(state.torchSupported);
			} catch (cameraError) {
				if (cancelled) return;
				// No camera, no permission, or a desktop without one: the file picker still works.
				console.warn('[scan] camera unavailable', cameraError);
				setCameraBlocked(true);
				setError(getCameraErrorMessage(cameraError, t));
			}
		})();
		return () => {
			cancelled = true;
			stopCamera();
		};
	}, [cameraBlocked, step, stopCamera, t]);

	React.useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.srcObject = stream;
		if (stream) void video.play().catch(() => undefined);
	}, [stream]);

	const capturePhoto = async (): Promise<void> => {
		const video = videoRef.current;
		if (!video || !stream) return;
		setBusy('reading');
		try {
			const file = await createCapturedPhotoFile(video, pages.length + 1, stream);
			// Let the stream go before the heavy work: the photo is already in hand, and the pixels
			// about to be allocated are better spent on it than on a preview nobody is watching.
			stopCamera();
			await ingestPhoto(file);
		} catch (captureError) {
			console.error('[scan] could not take that photo', captureError);
			setError(t('scan.photoFailed'));
			setBusy(null);
		}
	};

	const updateDraft = (change: Partial<Draft>): void => setDraft((current) => (current ? { ...current, ...change } : current));

	const moveCorner = (index: number, clientX: number, clientY: number): void => {
		const frame = frameRef.current;
		if (!frame || !draft) return;
		const rect = frame.getBoundingClientRect();
		const x = Math.min(draft.image.width, Math.max(0, ((clientX - rect.left) / rect.width) * draft.image.width));
		const y = Math.min(draft.image.height, Math.max(0, ((clientY - rect.top) / rect.height) * draft.image.height));
		updateDraft({ quad: draft.quad.map((corner, position) => (position === index ? { x, y } : corner)) as Quad });
	};

	// A quarter turn for a page that came out sideways: the photo and the corners on it turn together.
	const rotateDraft = async (): Promise<void> => {
		if (!draft) return;
		setBusy('working');
		try {
			const rotated = rotateImage(draft.image);
			const turned = draft.quad.map((corner) => ({ x: draft.image.height - 1 - corner.y, y: corner.x }));
			const photoBlob = await imageDataToBlob(rotated, 0.9);
			URL.revokeObjectURL(draft.previewUrl);
			updateDraft({
				image: rotated,
				quad: [turned[3], turned[0], turned[1], turned[2]] as Quad,
				previewUrl: URL.createObjectURL(photoBlob),
			});
		} catch (rotateError) {
			console.error('[scan] could not rotate that photo', rotateError);
			setError(t('scan.photoFailed'));
		} finally {
			setBusy(null);
		}
	};

	const addPage = async (): Promise<void> => {
		if (!draft) return;
		setBusy('working');
		setError(null);
		try {
			const size = quadOutputSize(draft.quad, maxWorkingSide());
			const warped = warpQuadToRectangle(draft.image, draft.quad, size.width, size.height);
			const cleaned = applyScanFilter(warped, draft.adjustments);
			const blob = await imageDataToBlob(cleaned);
			setPages((current) => [...current, {
				id: `${Date.now()}-${current.length}`,
				blob,
				width: cleaned.width,
				height: cleaned.height,
				previewUrl: URL.createObjectURL(blob),
			}]);
			discardDraft();
			setStep('pages');
		} catch (addError) {
			console.error('[scan] could not finish that page', addError);
			setError(t('scan.pageFailed'));
		} finally {
			setBusy(null);
		}
	};

	const movePage = (index: number, direction: -1 | 1): void => {
		setPages((current) => {
			const target = index + direction;
			if (target < 0 || target >= current.length) return current;
			const next = [...current];
			[next[index], next[target]] = [next[target], next[index]];
			return next;
		});
	};

	const removePage = (id: string): void => {
		setPages((current) => {
			const page = current.find((entry) => entry.id === id);
			if (page) URL.revokeObjectURL(page.previewUrl);
			const next = current.filter((entry) => entry.id !== id);
			if (next.length === 0) setStep('capture');
			return next;
		});
	};

	const save = async (): Promise<void> => {
		if (pages.length === 0) return;
		setBusy('saving');
		setError(null);
		try {
			const file = await buildScanPdf(pages, title || t('scan.defaultTitle'));
			await props.onSave(file);
			props.onClose();
		} catch (saveError) {
			console.error('[scan] could not save the scan', saveError);
			setError(t('scan.saveFailed'));
			setBusy(null);
		}
	};

	const filterOption = (filter: ScanFilter, label: string): React.JSX.Element => (
		<button
			type="button"
			className={`${styles.chip}${draft?.adjustments.filter === filter ? ` ${styles.chipActive}` : ''}`}
			onClick={() => updateDraft({ adjustments: { ...(draft?.adjustments ?? DEFAULT_SCAN_ADJUSTMENTS), filter } })}
		>
			{label}
		</button>
	);

	const stepNumber = step === 'capture' ? 1 : step === 'crop' ? 2 : step === 'clean' ? 3 : 4;
	const stepTitle = step === 'capture'
		? t('scan.stepCapture')
		: step === 'crop'
			? t('scan.stepCrop')
			: step === 'clean'
				? t('scan.stepClean')
				: t('scan.stepPages');

	const body = ((): React.ReactNode => {
		if (step === 'crop' && draft) {
			return (
				<>
					{/* The box keeps the photo's shape, so the corner handles (placed as percentages)
					    stay on the paper however the step is sized. */}
					<div className={styles.frame} ref={frameRef} style={{ aspectRatio: `${draft.image.width} / ${draft.image.height}` }}>
						<img className={styles.photo} src={draft.previewUrl} alt="" />
						<svg className={styles.outline} viewBox={`0 0 ${draft.image.width} ${draft.image.height}`} preserveAspectRatio="none" aria-hidden="true">
							<polygon points={draft.quad.map((corner) => `${corner.x},${corner.y}`).join(' ')} />
						</svg>
						{draft.quad.map((corner: Point, index: number) => (
							<button
								key={index}
								type="button"
								className={`${styles.corner}${draggingCorner === index ? ` ${styles.cornerActive}` : ''}`}
								style={{ left: `${(corner.x / draft.image.width) * 100}%`, top: `${(corner.y / draft.image.height) * 100}%` }}
								aria-label={t('scan.cornerLabel').replace('{n}', String(index + 1))}
								onPointerDown={(event) => {
									event.preventDefault();
									event.currentTarget.setPointerCapture(event.pointerId);
									setDraggingCorner(index);
								}}
								onPointerMove={(event) => {
									if (draggingCorner !== index) return;
									moveCorner(index, event.clientX, event.clientY);
								}}
								onPointerUp={(event) => {
									if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
									setDraggingCorner(null);
								}}
								onKeyDown={(event) => {
									const step_ = event.shiftKey ? 20 : 4;
									const deltas: Record<string, [number, number]> = { ArrowLeft: [-step_, 0], ArrowRight: [step_, 0], ArrowUp: [0, -step_], ArrowDown: [0, step_] };
									const delta = deltas[event.key];
									if (!delta) return;
									event.preventDefault();
									updateDraft({
										quad: draft.quad.map((point, position) => (position === index
											? { x: Math.min(draft.image.width, Math.max(0, point.x + delta[0])), y: Math.min(draft.image.height, Math.max(0, point.y + delta[1])) }
											: point)) as Quad,
									});
								}}
							/>
						))}
					</div>
					<p className={styles.hint}>{draft.detected ? t('scan.detectedHint') : t('scan.notDetectedHint')}</p>
				</>
			);
		}

		if (step === 'clean' && draft) {
			return (
				<>
					<div className={styles.resultPreview}>
						{previewUrl ? <img className={styles.resultImage} src={previewUrl} alt={t('scan.resultLabel')} /> : <div className={styles.resultPending}>{t('scan.processing')}</div>}
					</div>
					<div className={styles.controls}>
						<div className={styles.chips}>
							{filterOption('bw', t('scan.filterBw'))}
							{filterOption('grey', t('scan.filterGrey'))}
							{filterOption('colour', t('scan.filterColour'))}
						</div>
						<label className={styles.slider}>
							<span>{t('scan.brightness')}</span>
							<input
								type="range"
								min={-100}
								max={100}
								value={draft.adjustments.brightness}
								onChange={(event) => updateDraft({ adjustments: { ...draft.adjustments, brightness: Number(event.target.value) } })}
							/>
						</label>
						<label className={styles.slider}>
							<span>{t('scan.contrast')}</span>
							<input
								type="range"
								min={-100}
								max={100}
								value={draft.adjustments.contrast}
								onChange={(event) => updateDraft({ adjustments: { ...draft.adjustments, contrast: Number(event.target.value) } })}
							/>
						</label>
					</div>
				</>
			);
		}

		if (step === 'pages') {
			return (
				<ul className={styles.pages}>
					{pages.map((page, index) => (
						<li key={page.id} className={styles.pageCard}>
							<img className={styles.pageThumb} src={page.previewUrl} alt="" />
							<span className={styles.pageNumber}>{index + 1}</span>
							<div className={styles.pageActions}>
								<button type="button" className={styles.iconButton} onClick={() => movePage(index, -1)} disabled={index === 0} aria-label={t('scan.movePageBack')}>
									<FontAwesomeIcon icon={faChevronLeft} />
								</button>
								<button type="button" className={styles.iconButton} onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} aria-label={t('scan.movePageForward')}>
									<FontAwesomeIcon icon={faChevronRight} />
								</button>
								<button type="button" className={`${styles.iconButton} ${styles.iconButtonDanger}`} onClick={() => removePage(page.id)} aria-label={t('scan.removePage')}>
									<FontAwesomeIcon icon={faTrash} />
								</button>
							</div>
						</li>
					))}
				</ul>
			);
		}

		if (!cameraBlocked) {
			return (
				<div className={styles.cameraViewport}>
					<video ref={videoRef} className={styles.cameraVideo} autoPlay muted playsInline onCanPlay={() => setCameraReady(true)} />
					{!cameraReady ? <p className={styles.cameraStatus}>{t('media.cameraStarting')}</p> : null}
					{cameraReady && zoomRange ? (
						<div className={styles.cameraZoom}>
							<input
								type="range"
								min={zoomRange.min}
								max={zoomRange.max}
								step={zoomRange.step}
								value={zoomValue ?? zoomRange.defaultValue}
								aria-label={t('media.cameraZoom')}
								onChange={(event) => {
									const next = Number(event.currentTarget.value);
									setZoomValue(next);
									void setCameraZoom(streamRef.current, next);
								}}
							/>
						</div>
					) : null}
					{cameraReady && torchSupported ? (
						<button
							type="button"
							className={`${styles.torchButton}${torchOn ? ` ${styles.torchButtonOn}` : ''}`}
							aria-pressed={torchOn}
							aria-label={t('media.cameraFlash')}
							onClick={() => {
								const next = !torchOn;
								setTorchOn(next);
								void applyCameraTrackSettings(streamRef.current, { torch: next });
							}}
						>
							<FontAwesomeIcon icon={faBolt} />
						</button>
					) : null}
					<div className={styles.cameraActions}>
						<button
							type="button"
							className={styles.shutterButton}
							onClick={() => void capturePhoto()}
							disabled={busy !== null || !cameraReady}
							aria-label={t('media.capturePhoto')}
							title={t('media.capturePhoto')}
						>
							{busy === 'reading'
								? <FontAwesomeIcon className={styles.shutterBusy} icon={faArrowsRotate} spin />
								: <img src="/icons/Capture.png" className={styles.shutterIcon} alt="" aria-hidden="true" />}
						</button>
					</div>
				</div>
			);
		}
		return (
			<div className={styles.empty}>
				<p className={styles.emptyTitle}>{pages.length > 0 ? t('scan.captureAnother') : t('scan.emptyTitle')}</p>
				<p className={styles.emptyBody}>{isCoarsePointer ? t('scan.emptyBodyMobile') : t('scan.emptyBodyDesktop')}</p>
			</div>
		);
	})();

	const footer = ((): React.ReactNode => {
		if (step === 'capture') {
			return (
				<>
					{pages.length > 0 ? (
						<button type="button" className={styles.secondaryButton} onClick={() => setStep('pages')} disabled={busy !== null}>
							{t('scan.backToPages').replace('{n}', String(pages.length))}
						</button>
					) : null}
					<button type="button" className={styles.secondaryButton} onClick={() => inputRef.current?.click()} disabled={busy !== null}>
						<FontAwesomeIcon icon={faPlus} />
						<span>{t('scan.useFile')}</span>
					</button>
					{cameraBlocked ? (
						<button type="button" className={styles.primaryButton} onClick={() => inputRef.current?.click()} disabled={busy !== null}>
							<FontAwesomeIcon icon={busy === 'reading' ? faArrowsRotate : faCamera} spin={busy === 'reading'} />
							<span>{busy === 'reading' ? t('scan.reading') : t('scan.capture')}</span>
						</button>
					) : null}
				</>
			);
		}
		if (step === 'crop') {
			return (
				<>
					<button type="button" className={styles.secondaryButton} onClick={() => { discardDraft(); setStep(pages.length > 0 ? 'pages' : 'capture'); }} disabled={busy !== null}>
						{t('scan.retake')}
					</button>
					<button type="button" className={styles.secondaryButton} onClick={() => void rotateDraft()} disabled={busy !== null}>
						<FontAwesomeIcon icon={busy === 'working' ? faArrowsRotate : faRotateRight} spin={busy === 'working'} />
						<span>{t('scan.rotate')}</span>
					</button>
					<button type="button" className={styles.primaryButton} onClick={() => setStep('clean')} disabled={busy !== null}>
						<FontAwesomeIcon icon={faChevronRight} />
						<span>{t('scan.next')}</span>
					</button>
				</>
			);
		}
		if (step === 'clean') {
			return (
				<>
					<button type="button" className={styles.secondaryButton} onClick={() => setStep('crop')} disabled={busy !== null}>
						<FontAwesomeIcon icon={faChevronLeft} />
						<span>{t('scan.back')}</span>
					</button>
					<button type="button" className={styles.primaryButton} onClick={() => void addPage()} disabled={busy !== null}>
						<FontAwesomeIcon icon={busy === 'working' ? faArrowsRotate : faCheck} spin={busy === 'working'} />
						<span>{busy === 'working' ? t('scan.processing') : t('scan.usePage')}</span>
					</button>
				</>
			);
		}
		return (
			<>
				<label className={styles.titleField}>
					<span>{t('scan.titleLabel')}</span>
					<input type="text" value={title} placeholder={t('scan.defaultTitle')} onChange={(event) => setTitle(event.target.value)} />
				</label>
				<button type="button" className={styles.secondaryButton} onClick={() => setStep('capture')} disabled={busy !== null}>
					<FontAwesomeIcon icon={faPlus} />
					<span>{t('scan.captureAnother')}</span>
				</button>
				<button type="button" className={styles.primaryButton} onClick={() => void save()} disabled={pages.length === 0 || busy !== null}>
					<FontAwesomeIcon icon={busy === 'saving' ? faArrowsRotate : faCheck} spin={busy === 'saving'} />
					<span>{busy === 'saving' ? t('scan.saving') : t('scan.save')}</span>
				</button>
			</>
		);
	})();

	const content = (
		<div
			className={styles.backdrop}
			role="presentation"
			data-note-editor-overlay="true"
			onClick={stopEvent}
			onPointerDown={stopEvent}
			onPointerMove={stopEvent}
			onPointerUp={stopEvent}
			onTouchStart={stopEvent}
			onTouchMove={stopEvent}
			onTouchEnd={stopEvent}
			onWheel={stopEvent}
			onScroll={stopEvent}
		>
			<section className={styles.dialog} role="dialog" aria-modal="true" aria-label={t('scan.title')}>
				<header className={styles.header}>
					<div className={styles.headerCopy}>
						<p className={styles.stepLine}>{t('scan.stepOf').replace('{n}', String(stepNumber)).replace('{total}', '4')}</p>
						<h2 className={styles.title}>{stepTitle}</h2>
						<p className={styles.subtitle}>{pages.length > 0 ? t('scan.pageCount').replace('{n}', String(pages.length)) : t('scan.subtitle')}</p>
					</div>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={t('common.close')} title={t('common.close')}>
						<FontAwesomeIcon icon={faXmark} />
					</button>
				</header>

				{error ? <p className={styles.error} role="alert">{error}</p> : null}

				<div className={styles.body}>{body}</div>

				<footer className={styles.footer}>{footer}</footer>

				<input
					ref={inputRef}
					type="file"
					accept="image/*"
					{...(isCoarsePointer ? { capture: 'environment' as const } : {})}
					className={styles.hiddenInput}
					onChange={(event) => void handlePhotoChosen(event)}
					tabIndex={-1}
					aria-hidden="true"
				/>
			</section>
		</div>
	);

	return typeof window === 'undefined' ? null : createPortal(content, window.document.body);
}
