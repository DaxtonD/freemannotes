/**
 * Generates the notification badge (small status-bar icon) from the existing
 * notification icon source.
 *
 * Android/Chrome's Web Notification `badge` option MUST be an alpha-only
 * silhouette — the OS masks it and tints it itself (grey in the expanded
 * notification header, white in the status bar, sometimes the notification
 * channel's accent color). It is NOT a second place to show the full-color
 * logo. Before this script, `notification-badge.png` was just a copy of the
 * full-color `notification-icon.png` — Android had nothing to mask, so it drew
 * the colored logo a second time next to the (also full-color) large icon.
 * That's the "duplicate icon" users see in the notification header.
 *
 * This keeps every pixel's ALPHA exactly as it is in the source (so the shape
 * — including the outline — is untouched) and flattens every opaque pixel's
 * RGB to white, which is what the platform expects to mask/tint.
 *
 * Usage: node scripts/generate-notification-badge.mjs
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const source = path.join(publicDir, 'notification-icon.png');
const output = path.join(publicDir, 'notification-badge.png');

// Chrome scales the badge itself; a size in this range is plenty of
// resolution for a status-bar-sized icon without shipping the full 600×559
// source pixel-for-pixel.
const BADGE_SIZE = 192;

async function generateBadge() {
	const { data, info } = await sharp(source)
		.resize(BADGE_SIZE, BADGE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });

	// Sharp's own `joinChannel` ADDS a channel rather than replacing the alpha
	// one, so a naive "white background + joinChannel(extractedAlpha)" attempt
	// silently produces a fully-opaque image. Build the RGBA buffer directly
	// instead: white RGB everywhere, alpha copied byte-for-byte from the source.
	const out = Buffer.alloc(data.length);
	for (let i = 0; i < data.length; i += 4) {
		out[i] = 255;
		out[i + 1] = 255;
		out[i + 2] = 255;
		out[i + 3] = data[i + 3];
	}

	await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
		.png({ compressionLevel: 9 })
		.toFile(output);

	console.log(`✓ ${output} (${info.width}×${info.height}, white-on-transparent silhouette)`);
}

await generateBadge();
console.log('\nDone. Commit the regenerated notification-badge.png and rebuild.');
