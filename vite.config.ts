import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only: host the Yjs websocket backend on the SAME port as Vite under /yjs/*.
// This avoids the “desktop tabs sync locally but phone sees no notes” trap when
// a reverse proxy forwards only :27015 (HTTP) but not a separate :1234 (WS).
//
// NOTE: Vite also uses a websocket (/) for HMR. We only handle upgrades for /yjs.
import { WebSocketServer, type WebSocket } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import type { Plugin } from 'vite';

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

export default defineConfig(({ mode }) => {
	const envDir = './env.vite';
	const env = loadEnv(mode, envDir, 'VITE_');
	const devPort = Number(env.VITE_DEV_PORT || 5173);
	const apiProxyTarget = String(env.VITE_API_PROXY_TARGET || 'http://localhost:27015').trim();
	const yjsEmbedEnv = String(env.VITE_YJS_EMBED || '').trim();
	const yjsProxyEnv = String(env.VITE_YJS_PROXY || '').trim();
	// Branch policy for Yjs transport in Vite:
	// - Development branch: always embed Yjs websocket in Vite to eliminate noisy
	//   /yjs ws proxy disconnect logs during iterative mobile testing.
	// - Non-development branch: respect explicit env toggles for proxy/embed.
	const useYjsProxy = mode === 'development' ? false : yjsProxyEnv === '1';
	const embedYjs = mode === 'development' ? true : yjsEmbedEnv === '1';

	return {
		envDir,
		plugins: [react(), ...(embedYjs ? [yjsWebsocketPlugin()] : [])],
		server: {
			host: true,
			port: devPort,
			strictPort: true,
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
	};
});
