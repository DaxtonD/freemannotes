import React from 'react';

export function useBodyScrollLock(locked: boolean): void {
	React.useEffect(() => {
		if (!locked || typeof document === 'undefined') return;
		const previousOverflow = document.body.style.overflow;
		const previousOverscroll = (document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior;
		document.body.style.overflow = 'hidden';
		(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = 'none';
		return () => {
			document.body.style.overflow = previousOverflow;
			(document.body.style as unknown as { overscrollBehavior?: string }).overscrollBehavior = previousOverscroll || '';
		};
	}, [locked]);
}