import React from 'react';

const NOTE_IMAGE_CACHE_NAME = 'freemannotes-images-v1';

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

export function useResolvedNoteImageSource(options: ResolvedNoteImageSourceOptions): ResolvedNoteImageSourceState {
	const { fullUrl, thumbnailUrl, offlineThumbnailBlob, mode } = options;
	const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
	const [src, setSrc] = React.useState<string | null>(null);
	const [isOfflinePreview, setIsOfflinePreview] = React.useState(false);
	const [isUsingCachedFullImage, setIsUsingCachedFullImage] = React.useState(false);

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
		let cancelled = false;
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		(async () => {
			// Prefer a full image already stored by the service worker so viewer opens
			// at full fidelity offline without duplicating large blobs into IndexedDB.
			const cachedFull = fullUrl ? await hasCachedImage(fullUrl) : false;
			if (cancelled) return;
			if (cachedFull && fullUrl) {
				setSrc(fullUrl);
				setIsOfflinePreview(false);
				setIsUsingCachedFullImage(true);
				return;
			}
			setIsUsingCachedFullImage(false);
			if (mode === 'viewer') {
				// Viewer prefers the full image online, then falls back to the small
				// IndexedDB preview blob, then finally shows an explicit placeholder.
				if (!offline && fullUrl) {
					setSrc(fullUrl);
					setIsOfflinePreview(false);
					return;
				}
				if (objectUrl) {
					setSrc(objectUrl);
					setIsOfflinePreview(true);
					return;
				}
				setSrc(null);
				setIsOfflinePreview(false);
				return;
			}
			// Grid thumbnails use the cheap server thumbnail first, then the original
			// image if needed, then the tiny offline preview blob when disconnected.
			if (!offline && thumbnailUrl) {
				setSrc(thumbnailUrl);
				setIsOfflinePreview(false);
				return;
			}
			if (!offline && fullUrl) {
				setSrc(fullUrl);
				setIsOfflinePreview(false);
				return;
			}
			if (objectUrl) {
				setSrc(objectUrl);
				setIsOfflinePreview(true);
				return;
			}
			setSrc(null);
			setIsOfflinePreview(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [fullUrl, mode, objectUrl, thumbnailUrl]);

	const fallbackToOfflinePreview = React.useCallback(() => {
		if (!objectUrl) {
			setSrc(null);
			setIsOfflinePreview(false);
			return;
		}
		setSrc(objectUrl);
		setIsOfflinePreview(true);
		setIsUsingCachedFullImage(false);
	}, [objectUrl]);

	return {
		src,
		isOfflinePreview,
		isUsingCachedFullImage,
		showPlaceholder: !src,
		fallbackToOfflinePreview,
	};
}