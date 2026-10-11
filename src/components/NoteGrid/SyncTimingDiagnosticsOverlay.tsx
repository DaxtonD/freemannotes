import React from 'react';
import { CARD_DIAG_ENABLED } from '../../core/noteCardDiagnostics';
import { SCROLL_DIAG_ENABLED } from '../../core/gridScrollDiagnostics';
import {
	SYNC_DIAG_ENABLED,
	formatSyncDiagReport,
	getSyncDiagStatus,
} from '../../core/syncTimingDiagnostics';

/**
 * Report panel for `?syncDiag=1`.
 *
 * No record button, unlike the card and scroll diagnostics: the probe starts itself on page
 * load, because the window of interest is the app boot and you cannot press Record before
 * the thing you want to record. So this is a live counter you can watch settle, and a
 * `report` button that dumps what it has so far.
 *
 * Report goes into a selectable textarea as well as the clipboard, because the clipboard API
 * is unavailable on plain http and awkward in an installed PWA. Sits above whichever of the
 * other two diagnostic buttons are enabled.
 */
export function SyncTimingDiagnosticsOverlay(): React.JSX.Element | null {
	const [status, setStatus] = React.useState(() => getSyncDiagStatus());
	const [report, setReport] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState<'idle' | 'ok' | 'fail'>('idle');
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

	React.useEffect(() => {
		if (!SYNC_DIAG_ENABLED) return;
		// Poll rather than subscribe: the probe deliberately has no listeners, so nothing it
		// records can trigger a React render and perturb the thing being measured.
		const intervalId = window.setInterval(() => setStatus(getSyncDiagStatus()), 500);
		return () => window.clearInterval(intervalId);
	}, []);

	const buildReport = React.useCallback(() => {
		setReport(formatSyncDiagReport());
		setCopied('idle');
	}, []);

	const copyReport = React.useCallback(() => {
		const text = report ?? '';
		const node = textareaRef.current;
		if (node) {
			node.focus();
			node.select();
		}
		void (async () => {
			try {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(text);
					setCopied('ok');
					return;
				}
			} catch {
				// fall through to the manual path below
			}
			setCopied('fail');
		})();
	}, [report]);

	if (!SYNC_DIAG_ENABLED) return null;

	const bottomOffset = 12 + (CARD_DIAG_ENABLED ? 44 : 0) + (SCROLL_DIAG_ENABLED ? 44 : 0);
	const settled = status.pending === 0 && status.rooms > 0;

	return (
		<div
			style={{
				position: 'fixed',
				left: 12,
				bottom: bottomOffset,
				zIndex: 99999,
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
				fontSize: 12,
			}}
		>
			{report !== null ? (
				<div
					style={{
						width: 'min(92vw, 640px)',
						maxHeight: '70vh',
						display: 'flex',
						flexDirection: 'column',
						gap: 8,
						padding: 10,
						borderRadius: 10,
						background: '#101418',
						color: '#e6edf3',
						border: '1px solid #30363d',
						boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
					}}
				>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
						<strong>sync diag</strong>
						<span style={{ opacity: 0.8 }}>
							{status.synced}/{status.rooms} synced
						</span>
						<span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
							<button type="button" onClick={buildReport} style={buttonStyle}>refresh</button>
							<button type="button" onClick={copyReport} style={buttonStyle}>
								{copied === 'ok' ? 'copied' : copied === 'fail' ? 'select+copy' : 'copy'}
							</button>
							<button type="button" onClick={() => setReport(null)} style={buttonStyle}>close</button>
						</span>
					</div>
					{copied === 'fail' ? (
						<div style={{ color: '#f0b72f' }}>
							Clipboard blocked. Text is selected — use your copy gesture.
						</div>
					) : null}
					<textarea
						ref={textareaRef}
						readOnly
						value={report}
						spellCheck={false}
						style={{
							flex: '1 1 auto',
							minHeight: 220,
							resize: 'vertical',
							width: '100%',
							boxSizing: 'border-box',
							background: '#0b0f13',
							color: '#e6edf3',
							border: '1px solid #30363d',
							borderRadius: 6,
							padding: 8,
							fontFamily: 'inherit',
							fontSize: 11,
							lineHeight: 1.35,
							whiteSpace: 'pre',
							overflow: 'auto',
						}}
					/>
				</div>
			) : (
				<button
					type="button"
					onClick={buildReport}
					style={{
						...buttonStyle,
						padding: '8px 12px',
						borderColor: settled ? '#3fb950' : '#f0b72f',
					}}
				>
					{settled ? '✓' : '…'} sync diag · {status.synced}/{status.rooms} · {(status.elapsedMs / 1000).toFixed(0)}s
				</button>
			)}
		</div>
	);
}

const buttonStyle: React.CSSProperties = {
	background: '#21262d',
	color: '#e6edf3',
	border: '1px solid #30363d',
	borderRadius: 6,
	padding: '4px 8px',
	fontFamily: 'inherit',
	fontSize: 11,
	cursor: 'pointer',
};
