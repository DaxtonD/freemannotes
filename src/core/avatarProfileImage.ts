export type CropAreaPixels = { width: number; height: number; x: number; y: number };

export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.addEventListener('load', () => resolve(img));
		img.addEventListener('error', () => reject(new Error('Failed to load image')));
		img.crossOrigin = 'anonymous';
		img.src = src;
	});
}

export function getDefaultCenteredSquareCrop(image: HTMLImageElement): CropAreaPixels {
	const width = Math.max(1, Number(image.naturalWidth || image.width || 0));
	const height = Math.max(1, Number(image.naturalHeight || image.height || 0));
	const edge = Math.max(1, Math.min(width, height));
	return {
		width: edge,
		height: edge,
		x: Math.max(0, Math.round((width - edge) / 2)),
		y: Math.max(0, Math.round((height - edge) / 2)),
	};
}

export async function getAvatarUploadBlob(imageSrc: string, crop: CropAreaPixels | null, sizePx: number): Promise<Blob> {
	const image = await loadImage(imageSrc);
	const fallbackCrop = getDefaultCenteredSquareCrop(image);
	const safeCrop = crop
		&& Number.isFinite(crop.width)
		&& Number.isFinite(crop.height)
		&& crop.width > 0
		&& crop.height > 0
		? crop
		: fallbackCrop;

	const canvas = document.createElement('canvas');
	canvas.width = sizePx;
	canvas.height = sizePx;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not supported');

	ctx.drawImage(image, safeCrop.x, safeCrop.y, safeCrop.width, safeCrop.height, 0, 0, sizePx, sizePx);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('Failed to encode image');
	return blob;
}