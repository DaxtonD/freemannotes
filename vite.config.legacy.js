const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');
const { VitePWA } = require('vite-plugin-pwa');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const appVersion = String(packageJson.version || 'dev');

function parsePublicOrigin(rawValue) {
	const normalized = String(rawValue || '').trim();
	if (!normalized) return null;
	try {
		const url = new URL(normalized);
		url.pathname = '/';
		url.search = '';
		url.hash = '';
		return url;
	} catch {
		return null;
	}
}

function attachProxyErrorHandlers(proxy, label) {
	const swallowSocketError = (socket) => {
		if (!socket || typeof socket.on !== 'function') return;
		socket.on('error', () => {
			// Ignore raw socket resets so Vite stays alive while the backend restarts.
			// HTTP callers still get a 502 via the `error` handler below when applicable.
		});
	};

	proxy.on('error', (err, _req, resOrSocket) => {
		const message = err instanceof Error ? err.message : String(err);
		console.warn(`[vite-proxy:${label}] ${message}`);

		if (!resOrSocket) return;
		if (typeof resOrSocket.writeHead === 'function' && !resOrSocket.headersSent) {
			resOrSocket.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
			resOrSocket.end('Proxy target unavailable');
			return;
		}
		if (typeof resOrSocket.end === 'function') {
			try {
				resOrSocket.end();
			} catch {
				// ignore
			}
		}
	});

	proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
		swallowSocketError(socket);
	});

	proxy.on('open', (proxySocket) => {
		swallowSocketError(proxySocket);
	});
}

function excalidrawFontsPlugin() {
	const fontsSourceDir = path.resolve(__dirname, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts');
	let resolvedOutDir = '';
	return {
		name: 'freemannotes:excalidraw-fonts',
		configResolved(config) {
			resolvedOutDir = config.build.outDir;
		},
		// Dev server: serve Excalidraw font files from node_modules at /fonts/*.
		configureServer(server) {
			server.middlewares.use('/fonts', (req, res, next) => {
				const safeSuffix = (req.url || '/').replace(/\\/g, '/').replace(/\.\.+/g, '');
				const resolved = path.resolve(fontsSourceDir, '.' + safeSuffix);
				if (!resolved.startsWith(fontsSourceDir + path.sep) && resolved !== fontsSourceDir) {
					next();
					return;
				}
				if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
					next();
					return;
				}
				res.setHeader('Content-Type', resolved.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
				res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
				fs.createReadStream(resolved).pipe(res);
			});
		},
		// Build: copy fonts directory into the output so they're served at /fonts/*.
		closeBundle() {
			if (!resolvedOutDir || !fs.existsSync(fontsSourceDir)) return;
			const fontsDestDir = path.resolve(__dirname, resolvedOutDir, 'fonts');
			fs.cpSync(fontsSourceDir, fontsDestDir, { recursive: true, force: true });
		},
	};
}

function yjsWebsocketPlugin() {
	return {
		name: 'freemannotes:yjs-websocket',
		apply: 'serve',
		configureServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) return;

			const wss = new WebSocketServer({ noServer: true });

			httpServer.on('upgrade', (req, socket, head) => {
				socket.on('error', () => {
					// ignore (ECONNRESET etc)
				});

				const url = req.url || '/';
				if (!url.startsWith('/yjs')) return;
				console.info(`[yjs-ws-dev] upgrade ${url}`);

				try {
					wss.handleUpgrade(req, socket, head, (conn) => {
						wss.emit('connection', conn, req);
					});
				} catch {
					try {
						socket.destroy();
					} catch {
						// ignore
					}
				}
			});

			wss.on('connection', (conn, req) => {
				console.info(`[yjs-ws-dev] connected ${String(req.url || '/')}`);
				req.url = String(req.url || '/').replace(/^\/yjs/, '') || '/';
				setupWSConnection(conn, req, { gc: true });
			});

			httpServer.once('close', () => {
				wss.close();
			});
		},
	};
}

module.exports = defineConfig(({ mode }) => {
	const envDir = './env.vite';
	const env = loadEnv(mode, envDir, 'VITE_');
	const devPort = Number(env.VITE_DEV_PORT || 5173);
	const apiProxyTarget = String(env.VITE_API_PROXY_TARGET || 'http://localhost:27015').trim();
	const publicDevOrigin = parsePublicOrigin(String(env.VITE_DEV_PUBLIC_ORIGIN || ''));
	const embedYjs = String(env.VITE_YJS_EMBED || '').trim() === '1';
	const strictDevPort = publicDevOrigin
		? true
		: String(env.VITE_DEV_STRICT_PORT || '').trim() === '1';
	const hmrConfig = publicDevOrigin
		? {
			protocol: publicDevOrigin.protocol === 'https:' ? 'wss' : 'ws',
			host: publicDevOrigin.hostname,
			clientPort: publicDevOrigin.port
				? Number(publicDevOrigin.port)
				: (publicDevOrigin.protocol === 'https:' ? 443 : 80),
		}
		: undefined;

	return {
		envDir,
		plugins: [
			excalidrawFontsPlugin(),
			react(),
			VitePWA({
				strategies: 'injectManifest',
				srcDir: 'src',
				filename: 'sw.js',
				injectRegister: false,
				registerType: 'autoUpdate',
				includeAssets: [
					'pwa-192x192.png',
					'pwa-512x512.png',
					'pwa-192x192-maskable.png',
					'pwa-512x512-maskable.png',
					'apple-touch-icon.png',
				],
				manifest: {
					name: 'Freeman Notes',
					short_name: 'Freeman Notes',
					description: 'Offline-first collaborative note taking for personal and shared workspaces.',
					start_url: '/',
					scope: '/',
					display: 'standalone',
					orientation: 'portrait',
					// Match the default app background so Android standalone chrome does
					// not flash a white navigation bar before the runtime theme sync runs.
					theme_color: '#0b0f16',
					background_color: '#0b0f16',
					icons: [
						// 'any' icons are displayed as-is (transparent background preserved).
						// Used for browser tabs, notification trays, and launchers that
						// render the icon without cropping or background-filling.
						{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
						{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
						// 'maskable' icons have an opaque background (app dark theme colour)
						// and the logo scaled to fit within the inner 80% safe zone.
						// Android adaptive-icon launchers prefer these — without them the
						// launcher fills the transparent area with its own colour (often
						// white), making a light logo invisible.
						{ src: 'pwa-192x192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
						{ src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
					],
				},
				injectManifest: {
					globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
					maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
				},
				devOptions: {
					enabled: true,
					type: 'classic',
					navigateFallback: '/index.html',
				},
			}),
			...(embedYjs ? [yjsWebsocketPlugin()] : []),
		],
		define: {
			__APP_VERSION__: JSON.stringify(appVersion),
		},
		server: {
			host: true,
			port: devPort,
			// Reverse-proxied dev domains need a stable port; ad-hoc local sessions can
			// still opt into fallback ports by leaving VITE_DEV_PUBLIC_ORIGIN unset.
			strictPort: strictDevPort,
			origin: publicDevOrigin?.origin,
			hmr: hmrConfig,
			allowedHosts: true,
			proxy: {
				// Proxy API + uploads to the Node server so cookie-based auth remains same-origin.
				'/api': {
					target: apiProxyTarget,
					changeOrigin: true,
					xfwd: true,
					configure(proxy) {
						attachProxyErrorHandlers(proxy, 'api');
					},
				},
				'/uploads': {
					target: apiProxyTarget,
					changeOrigin: true,
					xfwd: true,
					configure(proxy) {
						attachProxyErrorHandlers(proxy, 'uploads');
					},
				},
				'/ws': {
					target: apiProxyTarget,
					ws: true,
					changeOrigin: true,
					xfwd: true,
					configure(proxy) {
						attachProxyErrorHandlers(proxy, 'ws');
					},
				},
				// Proxy Yjs websocket rooms to the Node server so dev can see persisted notes.
				...(embedYjs
					? {}
					: {
						'/yjs': {
							target: apiProxyTarget,
							ws: true,
							changeOrigin: true,
							xfwd: true,
							configure(proxy) {
								attachProxyErrorHandlers(proxy, 'yjs');
							},
						},
					}),
			},
		},
		preview: {
			host: true,
			port: Number(env.VITE_PREVIEW_PORT || 4173),
			strictPort: true,
		},
		build: {
			// The verified publish flow already deletes dist-build-temp before invoking
			// Vite. Keep nested builds (notably vite-plugin-pwa injectManifest's custom
			// service worker build) from emptying the shared outDir and deleting the
			// client build artifacts before Workbox scans them.
			emptyOutDir: false,
		},
	};
});
