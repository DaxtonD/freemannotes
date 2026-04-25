import React from 'react';
import { getConnectionQuality, subscribeConnectionQualityChange } from '../../core/networkQuality';

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
	const [connectionQuality, setConnectionQuality] = React.useState(() => getConnectionQuality());
	const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
	const [src, setSrc] = React.useState<string | null>(null);
	const [isOfflinePreview, setIsOfflinePreview] = React.useState(false);
	const [isUsingCachedFullImage, setIsUsingCachedFullImage] = React.useState(false);

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
		let cancelled = false;
		const offline = connectionQuality === 'offline';
		const poorConnection = connectionQuality === 'poor';
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
				// On poor links, prefer the low-quality local/server preview immediately
				// instead of blocking the viewer on the full-size original asset.
				if (objectUrl && (offline || poorConnection)) {
					setSrc(objectUrl);
					setIsOfflinePreview(true);
					return;
				}
				if (thumbnailUrl && (offline || poorConnection)) {
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
				return;
			}
			// Grid thumbnails use a preview-first policy: local preview on poor links,
			// then the cheap server thumbnail, then the original only on good links.
			if (objectUrl && (offline || poorConnection)) {
				setSrc(objectUrl);
				setIsOfflinePreview(true);
				return;
			}
			if (thumbnailUrl) {
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
	}, [connectionQuality, fullUrl, mode, objectUrl, thumbnailUrl]);

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