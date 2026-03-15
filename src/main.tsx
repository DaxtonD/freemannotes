import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DocumentManager } from './core/DocumentManager';
import { DocumentManagerProvider } from './core/DocumentManagerContext';
import { installTouchDragPolyfill } from './core/touchDragPolyfill';
import { I18nProvider } from './core/i18n';
import 'react-pdf-highlighter-plus/style/style.css';
import './styles/variables.css';
import './styles/globals.css';
import './styles/layout.css';

// Resolves default WS endpoint from current origin so desktop/mobile behave consistently
// in local and proxied environments.
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

// Read cached workspace ID so the DocumentManager initializes the notes
// registry under the correct workspace-prefixed IndexedDB room name from
// the very first tick. Without this, child component effects that await
// registry data can race against the parent effect that sets the workspace,
// causing the IndexedDB ready Promise to hang forever (provider destroyed
// mid-await). See DocumentManagerOptions.initialWorkspaceId.
function readCachedWorkspaceId(): string | null {
	try {
		const raw = localStorage.getItem('freemannotes.auth.cache.v1');
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed?.v !== 1 || typeof parsed.workspaceId !== 'string' || !parsed.workspaceId) return null;
		return parsed.workspaceId;
	} catch {
		return null;
	}
}

// Singleton manager owns Yjs docs + persistence providers for the entire app session.
// Websocket sync starts disabled because the App now gates sync behind auth.
// Once authenticated, App calls `manager.setWebsocketEnabled(true)`.
const manager = new DocumentManager(wsUrl, {
	enableWebsocketSync: false,
	initialWorkspaceId: readCachedWorkspaceId(),
});

const rootEl = document.getElementById('root');
if (!rootEl) {
	throw new Error('Missing #root element');
}

// Firefox Android does not synthesize dragstart from touch long-press.
// Install a polyfill that bridges touch events → DragEvents so
// @atlaskit/pragmatic-drag-and-drop works on Firefox Android.
installTouchDragPolyfill();

createRoot(rootEl).render(
	<React.StrictMode>
		<I18nProvider>
			<DocumentManagerProvider manager={manager}>
				<App />
			</DocumentManagerProvider>
		</I18nProvider>
	</React.StrictMode>
);

// Service worker registration + dev cleanup strategy.
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
