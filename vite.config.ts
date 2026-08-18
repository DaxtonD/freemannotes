import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: host the Yjs websocket backend on the SAME port as Vite under /yjs/*.
// This avoids the “desktop tabs sync locally but phone sees no notes” trap when
// a reverse proxy forwards only :27015 (HTTP) but not a separate :1234 (WS).
//
// NOTE: Vite also uses a websocket (/) for HMR. We only handle upgrades for /yjs.
import { WebSocketServer, type WebSocket } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import type { Plugin } from 'vite';

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version?: string };
const appVersion = String(packageJson.version || 'dev');

// A random per-process fingerprint, regenerated every time Vite starts (both `npm run
// dev` and `npm run build`) — shown in the app's About section and logged to the
// console on boot. package.json's version rarely changes between dev iterations, so on
// its own it can't answer "am I actually looking at what I just built" — this can.
function generateBuildTag(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let tag = '';
	for (let i = 0; i < 4; i += 1) tag += alphabet[Math.floor(Math.random() * alphabet.length)];
	return tag;
}
const buildTag = generateBuildTag();
// Same info as the browser console banner (main.tsx), but printed server-side so the
// tag is visible the instant `npm run dev`/`npm run build` starts — no browser required.
console.log(`[vite.config] Freeman Notes v${appVersion} · build ${buildTag}`);

function parsePublicOrigin(rawValue: string): URL | null {
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

function attachProxyErrorHandlers(proxy: any, label: string): void {
	const swallowSocketError = (socket: any): void => {
		if (!socket || typeof socket.on !== 'function') return;
		socket.on('error', () => {
			// Ignore raw socket resets so Vite stays alive while the backend restarts.
			// HTTP callers still get a 502 via the `error` handler below when applicable.
		});
	};

	proxy.on('error', (err: Error, _req: unknown, resOrSocket: any) => {
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

	proxy.on('proxyReqWs', (_proxyReq: unknown, _req: unknown, socket: any) => {
		swallowSocketError(socket);
	});

	proxy.on('open', (proxySocket: any) => {
		swallowSocketError(proxySocket);
	});
}

function excalidrawFontsPlugin(): Plugin {
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

function yjsWebsocketPlugin(): Plugin {
	return {
		name: 'freemannotes:yjs-websocket',
		apply: 'serve',
		configureServer(server) {
			const httpServer = server.httpServer;
			if (!httpServer) return;

			const wss = new WebSocketServer({ noServer: true });

			httpServer.on('upgrade', (req, socket, head) => {
				// Clients (especially mobile + proxies) can disconnect mid-upgrade.
				// If nobody listens to the socket error, Node will crash the process.
				socket.on('error', () => {
					// Intentionally ignored (common ECONNRESET).
				});

				const url = req.url || '/';
				if (!url.startsWith('/yjs')) {
					return;
				}
				console.info(`[yjs-ws-dev] upgrade ${url}`);

				try {
					wss.handleUpgrade(req, socket, head, (conn: WebSocket) => {
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
				console.info(`[yjs-ws-dev] connected ${(req.url || '/').toString()}`);
				// y-websocket expects the room name in the path, typically '/<room>'.
				// Our client connects to '/yjs/<room>', so strip the prefix.
				(req as any).url = String(req.url || '/').replace(/^\/yjs/, '') || '/';
				setupWSConnection(conn, req, { gc: true });
			});

			httpServer.once('close', () => {
				wss.close();
			});
		},
	};
}

export default defineConfig(({ mode, command }) => {
	const isDevServer = command === 'serve';
	const envDir = './env.vite';
	const env = loadEnv(mode, envDir, 'VITE_');
	const devPort = Number(env.VITE_DEV_PORT || 5173);
	const apiProxyTarget = String(env.VITE_API_PROXY_TARGET || 'http://localhost:27015').trim();
	const publicDevOrigin = parsePublicOrigin(String(env.VITE_DEV_PUBLIC_ORIGIN || ''));
	const yjsEmbedEnv = String(env.VITE_YJS_EMBED || '').trim();
	const yjsProxyEnv = String(env.VITE_YJS_PROXY || '').trim();
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
	// Branch policy for Yjs transport in Vite:
	// - Development branch: proxy /yjs to server.js, same as production, so dev
	//   testing actually proves prod behavior. The embedded in-Vite-process
	//   plugin below (yjsWebsocketPlugin) used to be the dev default instead —
	//   it runs in a separate Node process from server.js, so it has no access
	//   to persistAdapter and never calls registerDocWorkspace(). Since
	//   YjsPersistenceAdapter.bindState()'s PostgreSQL read is workspace-scoped
	//   (`WHERE docId = ... AND workspaceId = ...`), any room whose workspace
	//   was never registered silently loaded as empty — invisible for your own
	//   notes (they happen to get their workspace registered some other way)
	//   but permanently broken for a note shared into your workspace from
	//   someone else's, since nothing else ever registers that mapping. It
	//   also skipped auth and workspace-membership checks entirely. It was
	//   originally embedded instead of proxied "to eliminate noisy /yjs ws
	//   proxy disconnect logs during iterative mobile testing" — a real but
	//   cosmetic annoyance, not worth trading correctness for. Proxying costs
	//   noisier reconnect logs on flaky connections; it does not reintroduce
	//   this bug.
	// - Non-development branch: respect explicit env toggles for proxy/embed.
	const useYjsProxy = mode === 'development' ? true : yjsProxyEnv === '1';
	const embedYjs = mode === 'development' ? false : yjsEmbedEnv === '1';

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
					// NOT `version`/`version_name` — those aren't real Web App Manifest fields
					// (that's a Chrome *Extension* manifest field; browsers silently ignore it
					// here). There is no standard mechanism to control the version number Android
					// shows in its WebAPK App Info screen — it's a fixed "1" no matter what a PWA's
					// manifest says. The About-section build tag (__BUILD_TAG__) is the actual way
					// to verify what's running; don't re-add these expecting them to do anything.
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
			__BUILD_TAG__: JSON.stringify(buildTag),
			__IS_DEV_BUILD__: JSON.stringify(isDevServer),
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
				// Branch notes:
				// - When `embedYjs` is true, Vite itself handles /yjs upgrades via plugin.
				// - Only when `embedYjs` is false *and* `useYjsProxy` is true do we
				//   register the ws proxy entry.
				...((embedYjs || !useYjsProxy)
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
		optimizeDeps: {
			esbuildOptions: {
				// Excalidraw's ESM locale bundle requires the ES2022 parser target.
				target: 'es2022',
				treeShaking: true,
			},
		},
		build: {
			// The verified publish flow already deletes dist-build-temp before invoking
			// Vite. Keep nested builds (notably vite-plugin-pwa injectManifest's custom
			// service worker build) from emptying the shared outDir and deleting the
			// client build artifacts before Workbox scans them.
			target: 'es2022',
			emptyOutDir: false,
		},
	};
});
