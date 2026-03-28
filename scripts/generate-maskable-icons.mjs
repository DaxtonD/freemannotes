/**
 * Generates maskable PWA icon variants from the existing transparent source icon.
 *
 * A "maskable" icon has an opaque background that covers the entire canvas.
 * Android adaptive-icon launchers apply their own shape mask (circle, squircle,
 * etc.), so if no maskable icon is provided they fill the background themselves
 * (often white), which makes a light-coloured logo invisible.
 *
 * Safe-zone rule: all important content must fit within the inner 80% of the
 * icon (40% radius from centre). The outer 20% may be cropped by the launcher.
 *
 * Usage: node scripts/generate-maskable-icons.mjs
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const source = path.join(publicDir, 'pwa-512x512.png');

// App dark background — matches background_color in the PWA manifest.
const BG = { r: 11, g: 15, b: 22, alpha: 1 }; // #0b0f16

/**
 * Composites the source icon onto an opaque background canvas, scaled so the
 * logo fits within the safe zone (inner 80% of the output dimensions).
 */
async function generateMaskable(outputFile, size) {
    const safeZoneSize = Math.round(size * 0.8);

    // Resize source to fit fully within the safe zone (may be smaller if
    // the source is not square).
    const { data, info } = await sharp(source)
        .resize(safeZoneSize, safeZoneSize, {
            fit: 'inside',
            background: { r: 0, g: 0, b: 0, alpha: 0 },
            withoutEnlargement: false,
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const left = Math.round((size - info.width) / 2);
    const top = Math.round((size - info.height) / 2);

    await sharp({
        create: { width: size, height: size, channels: 4, background: BG },
    })
        .composite([{
            input: data,
            raw: { width: info.width, height: info.height, channels: 4 },
            left,
            top,
        }])
        .png({ compressionLevel: 9 })
        .toFile(outputFile);

    console.log(`✓ ${outputFile} (${size}×${size})`);
}

await generateMaskable(path.join(publicDir, 'pwa-512x512-maskable.png'), 512);
await generateMaskable(path.join(publicDir, 'pwa-192x192-maskable.png'), 192);
// Apple touch icon: iOS also adds a white background behind transparent PNGs,
// so supply the opaque variant here too (standard size: 180×180).
await generateMaskable(path.join(publicDir, 'apple-touch-icon.png'), 180);

console.log('\nDone. Commit the generated files and rebuild the PWA.');
