import React from 'react';
import { getConnectionQuality, reportImageLoadTiming, subscribeConnectionQualityChange } from '../../core/networkQuality';

const NOTE_IMAGE_CACHE_NAME = 'freemannotes-images-v1';

// How long a network image attempt gets before we give up and show the cached preview
// instead, when one is available. Thumbnails should be small — if a "thumbnail" is
// taking this long, the connection is bad, not the file. Viewer gets more rope since a
// full-quality photo is a legitimately bigger download even on a fine connection.
const NETWORK_IMAGE_TIMEOUT_MS: Record<'thumbnail' | 'viewer', number> = {
	thumbnail: 1800,
	viewer: 3500,
};

export type ResolvedNoteImageSourceOptions = {
	fullUrl?: string | null;
	thumbnailUrl?: string | null;
	offlineThumbnailBlob?: Blob | null;
	mode: 'thumbnail' | 'viewer';
};

export type ResolvedNoteImageSourceState = {
	src: string | null;
	isOfflinePreview: boolean;
	isUsingCachedFullImage: boolean;
	showPlaceholder: boolean;
	fallbackToOfflinePreview: () => void;
	/** Wire to the rendered <img>'s onLoad — times the network fetch so a slow-but-
	 *  undetected connection gets caught (and reported) even when nothing ever errors. */
	onImageLoad: () => void;
};

async function hasCachedImage(url: string): Promise<boolean> {
	if (!url || typeof window === 'undefined' || !('caches' in window)) return false;
	try {
		const cache = await window.caches.open(NOTE_IMAGE_CACHE_NAME);
		return Boolean(await cache.match(url));
	} catch {
		return false;
	}
}

// blob: URLs are device-local object URLs and remain accessible regardless of
// network connectivity. Queued-upload preview tiles pass a blob: URL as fullUrl.
function isBlobUrl(url: string | null | undefined): url is string {
	return typeof url === 'string' && url.startsWith('blob:');
}

function resolveImmediateSource(args: {
	fullUrl?: string | null;
	thumbnailUrl?: string | null;
	objectUrl?: string | null;
	mode: 'thumbnail' | 'viewer';
	connectionQuality: 'offline' | 'poor' | 'good';
}): { src: string | null; isOfflinePreview: boolean } {
	const { fullUrl, thumbnailUrl, objectUrl, mode, connectionQuality } = args;
	const offline = connectionQuality === 'offline';
	const poorConnection = connectionQuality === 'poor';
	// Pick the source directly from the current inputs so viewer navigation never
	// has to wait for an effect before switching away from the previous image.
	if (mode === 'viewer') {
		// Prefer blob: URLs first — they are locally accessible even when the device
		// is offline (queued image previews use URL.createObjectURL on the raw blob).
		if (isBlobUrl(fullUrl)) return { src: fullUrl, isOfflinePreview: true };
		if (isBlobUrl(thumbnailUrl)) return { src: thumbnailUrl, isOfflinePreview: true };
		if (objectUrl && (offline || poorConnection)) {
			return { src: objectUrl, isOfflinePreview: true };
		}
		if (thumbnailUrl && (offline || poorConnection)) {
			return { src: thumbnailUrl, isOfflinePreview: false };
		}
		if (!offline && fullUrl) {
			return { src: fullUrl, isOfflinePreview: false };
		}
		if (objectUrl) {
			return { src: objectUrl, isOfflinePreview: true };
		}
		return { src: null, isOfflinePreview: false };
	}
	// thumbnail mode
	if (isBlobUrl(fullUrl)) return { src: fullUrl, isOfflinePreview: true };
	if (isBlobUrl(thumbnailUrl)) return { src: thumbnailUrl, isOfflinePreview: true };
	if (objectUrl && (offline || poorConnection)) {
		return { src: objectUrl, isOfflinePreview: true };
	}
	if (thumbnailUrl) {
		return { src: thumbnailUrl, isOfflinePreview: false };
	}
	if (!offline && fullUrl) {
		return { src: fullUrl, isOfflinePreview: false };
	}
	if (objectUrl) {
		return { src: objectUrl, isOfflinePreview: true };
	}
	return { src: null, isOfflinePreview: false };
}

export function useResolvedNoteImageSource(options: ResolvedNoteImageSourceOptions): ResolvedNoteImageSourceState {
	const { fullUrl, thumbnailUrl, offlineThumbnailBlob, mode } = options;
	const [connectionQuality, setConnectionQuality] = React.useState(() => getConnectionQuality());
	const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
	const [isUsingCachedFullImage, setIsUsingCachedFullImage] = React.useState(false);
	const [preferOfflinePreview, setPreferOfflinePreview] = React.useState(false);

	React.useEffect(() => subscribeConnectionQualityChange(() => setConnectionQuality(getConnectionQuality())), []);

	React.useEffect(() => {
		if (!(offlineThumbnailBlob instanceof Blob)) {
			setObjectUrl(null);
			return;
		}
		const nextObjectUrl = URL.createObjectURL(offlineThumbnailBlob);
		setObjectUrl(nextObjectUrl);
		return () => URL.revokeObjectURL(nextObjectUrl);
	}, [offlineThumbnailBlob]);

	React.useEffect(() => {
		// Reset error-driven preview fallback whenever the requested image changes.
		setPreferOfflinePreview(false);
	}, [fullUrl, objectUrl]);

	// Derive the visible source during render so the first frame after a swipe is
	// already pointed at the next image instead of replaying stale state.
	const immediate = React.useMemo(() => resolveImmediateSource({
		fullUrl,
		thumbnailUrl,
		objectUrl,
		mode,
		connectionQuality,
	}), [connectionQuality, fullUrl, mode, objectUrl, thumbnailUrl]);

	React.useEffect(() => {
		let cancelled = false;
		setIsUsingCachedFullImage(false);
		(async () => {
			// Prefer a full image already stored by the service worker so viewer opens
			// at full fidelity offline without duplicating large blobs into IndexedDB.
			const cachedFull = fullUrl ? await hasCachedImage(fullUrl) : false;
			if (cancelled) return;
			if (cachedFull && fullUrl) {
				setIsUsingCachedFullImage(true);
				return;
			}
			setIsUsingCachedFullImage(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [fullUrl]);

	const fallbackPreviewSrc = objectUrl || null;
	// Once the service worker confirms a cached full asset exists, upgrade from
	// the immediate thumbnail/preview choice without reopening the stale frame.
	const src = preferOfflinePreview
		? fallbackPreviewSrc
		: isUsingCachedFullImage && fullUrl
			? fullUrl
			: immediate.src;
	const isOfflinePreview = preferOfflinePreview
		? Boolean(fallbackPreviewSrc)
		: isUsingCachedFullImage
			? false
			: immediate.isOfflinePreview;

	const fallbackToOfflinePreview = React.useCallback(() => {
		setPreferOfflinePreview(true);
		setIsUsingCachedFullImage(false);
	}, [objectUrl]);

	// onError alone only catches an outright failed request — a 404, a dropped
	// connection. It does nothing for a request that's merely taking forever, which is
	// exactly what a throttled-but-technically-online connection produces: the browser
	// just keeps waiting, no error ever fires, and the user stares at a placeholder (or
	// nothing) for as long as the network wants to take. Race the attempt against a
	// timeout instead, and only bother when there's actually a cached preview worth
	// falling back to — no local blob means there's nothing better to show anyway, so
	// let it run as long as it needs to.
	const timeoutRef = React.useRef<number | null>(null);
	const loadStartRef = React.useRef<number | null>(null);
	React.useEffect(() => {
		if (timeoutRef.current !== null) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		loadStartRef.current = null;
		if (preferOfflinePreview || isUsingCachedFullImage) return;
		if (!src || isOfflinePreview || isBlobUrl(src) || !objectUrl) return;
		loadStartRef.current = Date.now();
		const thresholdMs = NETWORK_IMAGE_TIMEOUT_MS[mode];
		timeoutRef.current = window.setTimeout(() => {
			// Report BEFORE falling back — every other image (this gallery, this
			// session) should start preferring cached previews immediately, not
			// re-discover the same slow connection one timeout at a time.
			reportImageLoadTiming(thresholdMs + 1, thresholdMs);
			setPreferOfflinePreview(true);
		}, thresholdMs);
		return () => {
			if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
		};
	}, [src, isOfflinePreview, isUsingCachedFullImage, mode, objectUrl, preferOfflinePreview]);

	const onImageLoad = React.useCallback(() => {
		if (timeoutRef.current !== null) {
			window.clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
		const startedAt = loadStartRef.current;
		loadStartRef.current = null;
		if (startedAt === null) return;
		// A genuinely fast load here clears a previously-observed-slow flag too, so a
		// connection that recovers isn't stuck treating every image as an emergency
		// for the rest of the session.
		reportImageLoadTiming(Date.now() - startedAt, NETWORK_IMAGE_TIMEOUT_MS[mode]);
	}, [mode]);

	return {
		src,
		isOfflinePreview,
		isUsingCachedFullImage,
		showPlaceholder: !src,
		fallbackToOfflinePreview,
		onImageLoad,
	};
}