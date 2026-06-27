export function isAndroidStandaloneExternalNavigationMode(): boolean {
	if (typeof window === 'undefined') return false;
	const ua = window.navigator.userAgent || '';
	if (!/Android/i.test(ua)) return false;
	return Boolean(
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
		window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
		document.referrer.startsWith('android-app://')
	);
}

export function getExternalLinkTarget(): '_blank' {
	return '_blank';
}

export function getExternalLinkRel(): string {
	return 'noreferrer noopener';
}