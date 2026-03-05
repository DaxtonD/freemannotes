const { defineConfig, loadEnv } = require('vite');
const react = require('@vitejs/plugin-react');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');

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
	const embedYjs = String(env.VITE_YJS_EMBED || '').trim() === '1';

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
				},
				'/uploads': {
					target: apiProxyTarget,
					changeOrigin: true,
					xfwd: true,
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
