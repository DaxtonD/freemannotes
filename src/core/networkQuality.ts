export type ConnectionQuality = 'offline' | 'poor' | 'good';

type BrowserConnection = {
	effectiveType?: string;
	downlink?: number;
	rtt?: number;
	saveData?: boolean;
	addEventListener?: (type: 'change', listener: () => void) => void;
	removeEventListener?: (type: 'change', listener: () => void) => void;
	onchange?: (() => void) | null;
};

type NavigatorWithConnection = Navigator & {
	connection?: BrowserConnection;
	mozConnection?: BrowserConnection;
	webkitConnection?: BrowserConnection;
};

function getBrowserConnection(): BrowserConnection | null {
	if (typeof navigator === 'undefined') return null;
	const nav = navigator as NavigatorWithConnection;
	return nav.connection ?? nav.mozConnection ?? nav.webkitConnection ?? null;
}

// Treat extremely slow links and data-saver mode similarly to offline for
// preview-heavy features so the UI prefers cached/lightweight assets sooner.
export function isPoorConnection(): boolean {
	const connection = getBrowserConnection();
	if (!connection) return false;
	if (connection.saveData) return true;
	const effectiveType = String(connection.effectiveType || '').toLowerCase();
	if (effectiveType === 'slow-2g' || effectiveType === '2g') return true;
	if (typeof connection.downlink === 'number' && connection.downlink > 0 && connection.downlink <= 0.35) return true;
	if (typeof connection.rtt === 'number' && connection.rtt >= 1200) return true;
	return false;
}

export function getConnectionQuality(): ConnectionQuality {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
	return isPoorConnection() ? 'poor' : 'good';
}

export function shouldTreatConnectionAsOffline(): boolean {
	const quality = getConnectionQuality();
	return quality === 'offline' || quality === 'poor';
}

export function subscribeConnectionQualityChange(listener: () => void): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const connection = getBrowserConnection();
	// Listen to both browser online/offline transitions and Network Information API
	// changes so galleries and media viewers can refresh immediately.
	window.addEventListener('online', listener);
	window.addEventListener('offline', listener);
	connection?.addEventListener?.('change', listener);
	return () => {
		window.removeEventListener('online', listener);
		window.removeEventListener('offline', listener);
		connection?.removeEventListener?.('change', listener);
	};
}