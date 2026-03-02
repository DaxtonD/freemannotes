import React from 'react';

export function useIsCoarsePointer(): boolean {
	const getInitial = (): boolean => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
		return window.matchMedia('(pointer: coarse)').matches;
	};

	const [isCoarse, setIsCoarse] = React.useState<boolean>(getInitial);

	React.useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const media = window.matchMedia('(pointer: coarse)');
		const onChange = (): void => setIsCoarse(media.matches);
		onChange();
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, []);

	return isCoarse;
}
