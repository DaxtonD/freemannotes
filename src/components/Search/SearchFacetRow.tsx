import React from 'react';

/**
 * One labelled row of search filter chips.
 *
 * Replaces a single row with thin vertical dividers between the three axes. The divider was the
 * only thing saying where one axis ended and the next began, which failed twice over: it is a 1px
 * line doing a grouping job, and it scrolls away with the content, so the moment you scrolled the
 * row the grouping it expressed stopped existing. A label in a fixed gutter says what the row is
 * no matter how far along it you have scrolled.
 *
 * Splitting by axis also mostly dissolves the overflow problem rather than decorating it: the
 * chips divide across three rows, so each row holds few enough to fit. When one still doesn't —
 * a note matched eight different ways on a narrow phone — the row scrolls, and the edge fades
 * below say so instead of letting chips silently run off the side.
 */

type ScrollEdges = 'none' | 'start' | 'end' | 'both';

/** Which edges have more content past them, for the fade mask. */
function readScrollEdges(element: HTMLElement): ScrollEdges {
	// A couple of px of slack: sub-pixel layout means scrollLeft rarely lands exactly on the
	// bounds, and a fade that never quite turns off looks like a rendering fault.
	const atStart = element.scrollLeft <= 1;
	const atEnd = element.scrollLeft >= element.scrollWidth - element.clientWidth - 1;
	if (atStart && atEnd) return 'none';
	if (atStart) return 'end';
	if (atEnd) return 'start';
	return 'both';
}

export function SearchFacetRow(props: { label: string; children: React.ReactNode }): React.JSX.Element {
	const scrollerRef = React.useRef<HTMLDivElement | null>(null);
	const [edges, setEdges] = React.useState<ScrollEdges>('none');

	React.useEffect(() => {
		const element = scrollerRef.current;
		if (!element) return undefined;
		const update = (): void => setEdges(readScrollEdges(element));
		update();
		element.addEventListener('scroll', update, { passive: true });
		// The chips themselves change as counts update and as the panel resizes, and either can
		// turn overflow on or off without a scroll event ever firing.
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => {
			element.removeEventListener('scroll', update);
			observer.disconnect();
		};
	}, [props.children]);

	return (
		<div className="global-search-facet-row">
			<span className="global-search-facet-row-label">{props.label}</span>
			<div className="global-search-facet-scroller" data-edges={edges} ref={scrollerRef}>
				{props.children}
			</div>
		</div>
	);
}
