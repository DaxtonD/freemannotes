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

// isPoorConnection() above is a pure guess from the Network Information API, and the
// guess just isn't good enough by itself. A user throttled their connection and every
// image in the gallery still went and sat there waiting on a full network fetch
// instead of using the cached preview blob sitting right there doing nothing, because
// effectiveType/downlink/rtt never crossed these thresholds for a "meaningfully slow
// but not literal dial-up" profile — which is most real-world "bad connection" testing,
// not just the extreme edge these numbers were apparently calibrated for. Chrome's
// NetInfo values are a rolling average of recent traffic, not a live readout of "is the
// request I'm about to make going to be slow," so trusting it alone was always going
// to whiff on exactly that case. This tracks what actually happened the last time an
// image load was
// timed, as a second, empirical signal — the first image on a badly-throttled
// connection still eats one real timeout, but every image after that (this one, this
// gallery, this whole session) benefits immediately instead of each one independently
// discovering the same slow connection the hard way.
let lastObservedSlow = false;

const OBSERVED_QUALITY_CHANGE_EVENT = 'freemannotes:observed-connection-quality-change';

export function reportImageLoadTiming(durationMs: number, thresholdMs: number): void {
	const nextSlow = durationMs > thresholdMs;
	if (nextSlow === lastObservedSlow) return;
	lastObservedSlow = nextSlow;
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new Event(OBSERVED_QUALITY_CHANGE_EVENT));
	}
}

export function getConnectionQuality(): ConnectionQuality {
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
	return (isPoorConnection() || lastObservedSlow) ? 'poor' : 'good';
}

export function shouldTreatConnectionAsOffline(): boolean {
	const quality = getConnectionQuality();
	return quality === 'offline' || quality === 'poor';
}

export function subscribeConnectionQualityChange(listener: () => void): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const connection = getBrowserConnection();
	// Listen to both browser online/offline transitions and Network Information API
	// changes so galleries and media viewers can refresh immediately. Also listen for
	// our own empirically-observed-slow signal above, since that's the one that
	// actually catches a throttled connection NetInfo doesn't flag.
	window.addEventListener('online', listener);
	window.addEventListener('offline', listener);
	window.addEventListener(OBSERVED_QUALITY_CHANGE_EVENT, listener);
	connection?.addEventListener?.('change', listener);
	return () => {
		window.removeEventListener('online', listener);
		window.removeEventListener('offline', listener);
		window.removeEventListener(OBSERVED_QUALITY_CHANGE_EVENT, listener);
		connection?.removeEventListener?.('change', listener);
	};
}