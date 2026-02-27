import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DocumentManager } from './core/DocumentManager';
import { DocumentManagerProvider } from './core/DocumentManagerContext';
import './styles.css';

function getDefaultWsUrl(): string {
	if (typeof window === 'undefined') return 'ws://localhost:1234';

	const { protocol, hostname, port } = window.location;
	const isHttps = protocol === 'https:';
	const wsScheme = isHttps ? 'wss' : 'ws';

	// The app expects the Yjs websocket backend to be available on the same origin
	// under `/yjs` (see vite.config.ts dev plugin + reverse-proxy config).
	// This makes behavior consistent across desktop + mobile.
	const portPart = port ? `:${port}` : '';
	return `${wsScheme}://${hostname}${portPart}/yjs`;
}

const wsUrl = (import.meta as any).env?.VITE_WS_URL || getDefaultWsUrl();

const manager = new DocumentManager(wsUrl);

const rootEl = document.getElementById('root');
if (!rootEl) {
	throw new Error('Missing #root element');
}

createRoot(rootEl).render(
	<React.StrictMode>
		<DocumentManagerProvider manager={manager}>
			<App />
		</DocumentManagerProvider>
	</React.StrictMode>
);

if ('serviceWorker' in navigator) {
	if (import.meta.env.DEV) {
		// Branch: clear any stale SW/caches from previous runs,
		// then register a dev-safe SW (see public/sw.js for cache bypass rules).
		navigator.serviceWorker
			.getRegistrations()
			.then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
			.then(() => caches.keys())
			.then((names) => Promise.all(names.map((name) => caches.delete(name))))
			.catch((error) => {
				console.warn('[SW] dev cleanup failed:', error);
			})
			.finally(() => {
				navigator.serviceWorker.register('/sw.js').catch((error) => {
					console.error('[SW] registration failed:', error);
				});
			});
	} else {
		navigator.serviceWorker.register('/sw.js').catch((error) => {
			console.error('[SW] registration failed:', error);
		});
	}
}
