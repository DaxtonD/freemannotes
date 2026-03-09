import React from 'react';

interface VisualViewportInfo {
	height: number;
	offsetTop: number;
}

/**
 * Returns the visual viewport height and offset in pixels, updating live as
 * the software keyboard opens/closes on mobile. Returns null on SSR.
 */
export function useVisualViewportHeight(): VisualViewportInfo | null {
	const [info, setInfo] = React.useState<VisualViewportInfo | null>(() => {
		if (typeof window === 'undefined') return null;
		const vv = window.visualViewport;
		return { height: vv?.height ?? window.innerHeight, offsetTop: vv?.offsetTop ?? 0 };
	});

	React.useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;

		const update = (): void => setInfo({ height: vv.height, offsetTop: vv.offsetTop });
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
		};
	}, []);

	return info;
}
