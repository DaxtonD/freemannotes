import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev-only: host the Yjs websocket backend on the SAME port as Vite under /yjs/*.
// This avoids the “desktop tabs sync locally but phone sees no notes” trap when
// a reverse proxy forwards only :27015 (HTTP) but not a separate :1234 (WS).
//
// NOTE: Vite also uses a websocket (/) for HMR. We only handle upgrades for /yjs.
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils';
import type { Plugin } from 'vite';

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

	return {
		envDir,
		plugins: [react(), yjsWebsocketPlugin()],
		server: {
			host: true,
			port: devPort,
			strictPort: true,
			allowedHosts: true,
		},
		preview: {
			host: true,
			port: Number(env.VITE_PREVIEW_PORT || 4173),
			strictPort: true,
		},
	};
});
