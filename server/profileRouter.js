'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// profileRouter.js — User profile endpoints (currently: profile image upload).
//
// Endpoint:
//   - POST /api/user/profile-image  (multipart/form-data)
//
// Behavior:
//   - Accepts a single image file (jpeg/png/webp), up to MAX_FILE_BYTES.
//   - Re-encodes and normalizes the image using Sharp:
//       - auto-rotate via EXIF
//       - resize to 256x256 square (cover)
//       - encode to webp
//   - Stores the resulting file as `${userId}.webp` in `uploadDir`.
//   - Updates `user.profileImage` with a public URL under `/uploads/`.
//
// Security / safety notes:
//   - Requires authentication; uses cookie session.
//   - Uses `enforceSameOrigin` to reduce CSRF risk.
//   - Server-side image processing prevents clients from uploading arbitrary
//     large images or non-image payloads.
//
// Operational notes:
//   - `uploadDir` must be configured by the server bootstrap and should be
//     served statically at `/uploads/*`.
//   - Overwrites are intentional (re-upload replaces the previous avatar).
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const Busboy = require('busboy');
const sharp = require('sharp');
const { enforceSameOrigin } = require('./auth');

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function jsonResponse(res, status, body) {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store',
	});
	res.end(json);
}

function createProfileRouter({ prisma, uploadDir }) {
	if (!uploadDir) throw new Error('uploadDir is required');

	function requireAuth(req, res) {
		if (!req.auth || !req.auth.userId) {
			jsonResponse(res, 401, { error: 'Not authenticated' });
			return null;
		}
		return req.auth.userId;
	}

	function handleRequest(req, res) {
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const pathname = url.pathname;
		const method = req.method || 'GET';

		if (!enforceSameOrigin(req, res)) return true;

		// POST /api/user/profile-image (multipart/form-data)
		if (pathname === '/api/user/profile-image' && method === 'POST') {
			const userId = requireAuth(req, res);
			if (!userId) return true;

			const bb = Busboy({
				headers: req.headers,
				limits: { files: 1, fileSize: MAX_FILE_BYTES },
			});

			// We buffer the file in-memory because we immediately transform it.
			// The MAX_FILE_BYTES limit keeps this bounded.

			let fileBuffer = null;
			let fileMime = '';
			let fileError = null;
			let sawFile = false;

			bb.on('file', (_fieldname, file, info) => {
				sawFile = true;
				fileMime = String(info.mimeType || '').toLowerCase();

				if (!['image/jpeg', 'image/png', 'image/webp'].includes(fileMime)) {
					fileError = 'Unsupported file type';
					file.resume();
					return;
				}

				const chunks = [];
				file.on('data', (d) => chunks.push(d));
				file.on('limit', () => {
					fileError = 'File too large';
				});
				file.on('end', () => {
					if (!fileError) fileBuffer = Buffer.concat(chunks);
				});
			});

			bb.on('error', (err) => {
				fileError = err.message || 'Upload failed';
			});

			bb.on('finish', async () => {
				try {
					if (!sawFile) {
						jsonResponse(res, 400, { error: 'No file uploaded' });
						return;
					}
					if (fileError) {
						jsonResponse(res, fileError === 'File too large' ? 413 : 400, { error: fileError });
						return;
					}
					if (!fileBuffer || fileBuffer.length === 0) {
						jsonResponse(res, 400, { error: 'Empty upload' });
						return;
					}

					await fs.promises.mkdir(uploadDir, { recursive: true });

					const out = await sharp(fileBuffer)
						.rotate()
						.resize(256, 256, { fit: 'cover' })
						.webp({ quality: 82 })
						.toBuffer();

					const filename = `${userId}.webp`;
					const fullPath = path.join(uploadDir, filename);
					await fs.promises.writeFile(fullPath, out);

					const publicPath = `/uploads/${filename}`;
					await prisma.user.update({
						where: { id: userId },
						data: { profileImage: publicPath },
					});

					jsonResponse(res, 200, { profileImage: publicPath });
				} catch (err) {
					console.error('[profile] upload error:', err.message);
					jsonResponse(res, 500, { error: 'Internal server error' });
				}
			});

			req.pipe(bb);
			return true;
		}

		return false;
	}

	return handleRequest;
}

module.exports = { createProfileRouter };
