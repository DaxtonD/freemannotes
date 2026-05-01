import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DocumentManager } from './core/DocumentManager';
import { DocumentManagerProvider } from './core/DocumentManagerContext';
import { initPwa } from './core/pwa';
import { logClientEvent } from './core/debugLogger';
import { StartupHydrationProvider } from './core/StartupHydrationContext';
import { hydrateStartupSnapshot, readSynchronousStartupHydrationSnapshot, type StartupHydrationSnapshot } from './core/startupHydration';
import { applyTheme, getStoredThemeIdForUser } from './core/theme';
import { installTouchDragPolyfill } from './core/touchDragPolyfill';
import { I18nProvider } from './core/i18n';
import { readWorkspaceSelectionCache } from './core/workspaceSelectionCache';
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
		// Prefer the dedicated workspace-selection cache (updated on every switch,
		// including offline switches) over the auth cache (which reflects the server
		// session and may lag behind the latest local workspace change).
		const cachedWorkspaceSelection = readWorkspaceSelectionCache();
		if (cachedWorkspaceSelection?.workspaceId) {
			return cachedWorkspaceSelection.workspaceId;
		}
		const raw = localStorage.getItem('freemannotes.auth.cache.v1');
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed?.v !== 1 || typeof parsed.workspaceId !== 'string' || !parsed.workspaceId) return null;
		return parsed.workspaceId;
	} catch {
		return null;
	}
}

function readCachedAuthUserId(): string | null {
	try {
		const raw = localStorage.getItem('freemannotes.auth.cache.v1');
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { v?: unknown; userId?: unknown } | null;
		return parsed?.v === 1 && typeof parsed.userId === 'string' && parsed.userId ? parsed.userId : null;
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

// Apply the last-used theme before React mounts so Android standalone chrome
// sees the current app background immediately instead of the HTML fallback.
applyTheme(getStoredThemeIdForUser(readCachedAuthUserId()));

function BootRoot(): React.JSX.Element {
	const [startupHydration, setStartupHydration] = React.useState<StartupHydrationSnapshot>(() => readSynchronousStartupHydrationSnapshot());
	const firstRenderLoggedRef = React.useRef(false);

	React.useEffect(() => {
		let cancelled = false;
		void hydrateStartupSnapshot(manager).then((nextSnapshot) => {
			if (cancelled) return;
			setStartupHydration((current) => {
				if (current.hydratedAt >= nextSnapshot.hydratedAt) return current;
				return nextSnapshot;
			});
		});
		return () => {
			cancelled = true;
		};
	}, []);

	React.useEffect(() => {
		if (typeof window === 'undefined' || firstRenderLoggedRef.current) return;
		firstRenderLoggedRef.current = true;
		window.requestAnimationFrame(() => {
			void logClientEvent('UI_FIRST_RENDER', {
				hydratedAt: startupHydration.hydratedAt,
				hasWarmCache: startupHydration.hasWarmCache,
				workspaceId: startupHydration.workspaceId,
				workspaceCount: startupHydration.workspaceList.length,
			});
		});
	}, [startupHydration]);

	return (
		<StartupHydrationProvider value={startupHydration}>
			<I18nProvider>
				<DocumentManagerProvider manager={manager}>
					<App />
				</DocumentManagerProvider>
			</I18nProvider>
		</StartupHydrationProvider>
	);
}

void logClientEvent('APP_INIT', {
	cachedWorkspaceId: readCachedWorkspaceId(),
	cachedAuthUserId: readCachedAuthUserId(),
});

createRoot(rootEl).render(
	<React.StrictMode>
		<BootRoot />
	</React.StrictMode>
);

initPwa();
