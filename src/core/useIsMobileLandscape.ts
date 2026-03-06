import * as React from 'react';

// Capability-based mobile-landscape query:
// - `pointer: coarse` avoids triggering on narrow desktop windows.
// - `orientation: landscape` allows strict layout locks only when rotated.
const QUERY = '(pointer: coarse) and (orientation: landscape)';

export function useIsMobileLandscape(): boolean {
	const getSnapshot = React.useCallback((): boolean => {
		// SSR / non-browser branch: return a stable false value to avoid hydration
		// mismatches and because matchMedia is unavailable outside the browser.
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
		return window.matchMedia(QUERY).matches;
	}, []);

	const [matches, setMatches] = React.useState<boolean>(() => getSnapshot());

	React.useEffect(() => {
		// Runtime guard branch mirrors getSnapshot for environments where hooks can
		// execute but media APIs are still unavailable.
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const mql = window.matchMedia(QUERY);
		const onChange = (): void => setMatches(mql.matches);

		onChange();
		if (typeof mql.addEventListener === 'function') {
			// Modern browser branch.
			mql.addEventListener('change', onChange);
			return () => mql.removeEventListener('change', onChange);
		}
		// Legacy Safari branch (<14) that still requires addListener/removeListener.
		mql.addListener(onChange);
		return () => mql.removeListener(onChange);
	}, [getSnapshot]);

	return matches;
}
