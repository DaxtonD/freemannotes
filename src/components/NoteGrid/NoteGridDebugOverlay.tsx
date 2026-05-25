import React from 'react';
import { getDebugSummary, type GridDebugSummary, type NoteDebugInfo } from './gridDebug';

type Props = {
	columns: readonly string[][];
	noteHeightByIdRef: React.RefObject<Map<string, number>>;
};

export const NoteGridDebugOverlay = React.memo(function NoteGridDebugOverlay({
	columns,
	noteHeightByIdRef,
}: Props) {
	const [summary, setSummary] = React.useState<GridDebugSummary | null>(null);
	const [tick, setTick] = React.useState(0);

	React.useEffect(() => {
		const interval = window.setInterval(() => {
			setSummary(getDebugSummary());
			setTick((value) => value + 1);
		}, 250);
		return () => window.clearInterval(interval);
	}, []);

	const isOverlayEnabled =
		typeof window !== 'undefined' &&
		Boolean((window as Window & { __noteGridDebugOverlay?: boolean }).__noteGridDebugOverlay);

	if (!isOverlayEnabled) return null;

	const live = summary?.liveState ?? null;

	return (
		<>
			<div
				style={{
					position: 'fixed',
					top: 8,
					right: 8,
					zIndex: 99999,
					background: 'rgba(10, 12, 16, 0.92)',
					color: '#d8f3dc',
					fontFamily: 'Consolas, Monaco, monospace',
					fontSize: 11,
					padding: '10px 12px',
					borderRadius: 8,
					maxWidth: 360,
					lineHeight: 1.45,
					pointerEvents: 'none',
					boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
				}}
			>
				<div style={{ fontWeight: 700, marginBottom: 6, color: '#f1fa8c' }}>NoteGrid Debug</div>
				{summary ? (
					<>
						<div>renders: {summary.renderCount}</div>
						<div>repacks: {summary.repackCount} ({summary.repacks_per_second_last20.toFixed(1)}/s)</div>
						<div>last reason: {summary.lastRepackReason ?? '-'}</div>
						<div>before heights: {formatNumberList(summary.columnHeightsBefore)}</div>
						<div>after heights: {formatNumberList(summary.columnHeightsAfter)}</div>
						<div>rendered: {live?.renderedCount ?? columns.flat().length} notes</div>
						<div>active drag: {live?.activeDragId ?? '-'}</div>
						<div>drop settle: {live?.isDropSettling ? live.dropSettlingNoteId ?? 'true' : 'false'}</div>
						<div>anchors: {live?.activeViewportAnchorIds.length ?? 0}</div>
						<div>animations: {live?.activeAnimations.join(', ') || '-'}</div>
						<div>suppressed: {summary.rebalanceSuppressionReason ?? '-'}</div>
						<div>debounced: {summary.rebalanceDebounceReason ?? '-'}</div>
						<div>invalidations: {summary.activeInvalidations.map((entry) => `${entry.noteId.slice(0, 6)}:${entry.reason}`).join(', ') || '-'}</div>
						<div style={{ marginTop: 6, color: '#8ecae6' }}>recent events</div>
						{summary.recentEvents.slice(-8).map((event, index) => (
							<div key={`${event.type}-${index}`} style={{ color: '#bde0fe', fontSize: 10 }}>
								{event.type}{typeof event.data?.reason === 'string' ? ` (${event.data.reason})` : ''}
							</div>
						))}
					</>
				) : (
					<div style={{ color: '#94a3b8' }}>loading</div>
				)}
			</div>

			{columns.map((columnIds, fallbackColumnIndex) =>
				columnIds.map((noteId) => (
					<PerNoteDebugBadge
						key={noteId}
						noteId={noteId}
						fallbackColumnIndex={fallbackColumnIndex}
						fallbackMeasuredHeight={noteHeightByIdRef.current?.get(noteId)}
						noteDebug={summary?.noteDebugById[noteId] ?? null}
						tick={tick}
					/>
				))
			)}
		</>
	);
});

function formatNumberList(values: readonly number[]): string {
	if (values.length === 0) return '-';
	return values.map((value) => Math.round(value)).join(', ');
}

function buildFlagLine(noteDebug: NoteDebugInfo | null): string {
	if (!noteDebug) return '-';
	const flags = [
		noteDebug.isViewportAnchor ? 'anchor' : '',
		noteDebug.isRecentlyMoved ? 'moved' : '',
		noteDebug.isHeightChanged ? 'height' : '',
		noteDebug.isAffectedByExpansion ? 'expand' : '',
		noteDebug.viewportStabilityOverridden ? 'vp-override' : '',
		noteDebug.stableOrderOverridden ? 'stable-override' : '',
		noteDebug.tieBreakerOccurred ? 'tie' : '',
	].filter(Boolean);
	return flags.join(' ') || '-';
}

const PerNoteDebugBadge = React.memo(function PerNoteDebugBadge({
	noteId,
	fallbackColumnIndex,
	fallbackMeasuredHeight,
	noteDebug,
	tick,
}: {
	noteId: string;
	fallbackColumnIndex: number;
	fallbackMeasuredHeight: number | undefined;
	noteDebug: NoteDebugInfo | null;
	tick: number;
}) {
	const [rect, setRect] = React.useState<DOMRect | null>(null);

	React.useEffect(() => {
		if (typeof document === 'undefined') return;
		const element = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
		if (!element) {
			setRect(null);
			return;
		}
		setRect(element.getBoundingClientRect());
	}, [noteId, tick]);

	if (!rect) return null;

	const measuredHeight = noteDebug?.measuredHeight ?? fallbackMeasuredHeight ?? null;
	const columnIndex = noteDebug?.columnIndex ?? fallbackColumnIndex;
	const siblingIndex = noteDebug?.siblingIndex ?? null;
	const badgeColor = noteDebug?.viewportStabilityOverridden
		? 'rgba(255, 166, 43, 0.82)'
		: noteDebug?.stableOrderOverridden
			? 'rgba(255, 214, 10, 0.82)'
			: noteDebug?.isViewportAnchor
				? 'rgba(2, 132, 199, 0.82)'
				: 'rgba(15, 23, 42, 0.82)';

	return (
		<div
			style={{
				position: 'fixed',
				left: rect.left + 2,
				top: rect.top + 2,
				zIndex: 99998,
				background: badgeColor,
				color: '#f8fafc',
				fontFamily: 'Consolas, Monaco, monospace',
				fontSize: 9,
				padding: '2px 4px',
				borderRadius: 4,
				pointerEvents: 'none',
				lineHeight: 1.35,
				maxWidth: Math.max(96, rect.width - 4),
				overflow: 'hidden',
				boxShadow: '0 4px 12px rgba(0, 0, 0, 0.28)',
			}}
		>
			<div>{noteId.slice(0, 8)} c:{columnIndex} s:{siblingIndex ?? '-'}</div>
			<div>h:{measuredHeight ?? '?'} r:{noteDebug?.renderCount ?? 0}</div>
			<div>{noteDebug?.placementReason ?? '-'}</div>
			<div>{noteDebug?.stabilityPriority ?? '-'}</div>
			<div>{buildFlagLine(noteDebug)}</div>
		</div>
	);
});