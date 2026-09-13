import React from 'react';
import { CARD_DIAG_ENABLED } from '../../core/noteCardDiagnostics';
import {
	SCROLL_DIAG_ENABLED,
	formatScrollDiagReport,
	getScrollDiagStatus,
	startScrollDiag,
	stopScrollDiag,
} from '../../core/gridScrollDiagnostics';

/**
 * Record / stop / copy panel for `?scrollDiag=1`.
 *
 * Kept deliberately tiny while recording so it doesn't cover the cards being
 * recorded. Like the card diag panel, the report goes into a selectable textarea
 * as well as the clipboard, because the clipboard API is unavailable on plain http.
 * Sits just above the card diag button when both are enabled.
 */
export function GridScrollDiagnosticsOverlay(): React.JSX.Element | null {
	const [status, setStatus] = React.useState(() => getScrollDiagStatus());
	const [report, setReport] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState<'idle' | 'ok' | 'fail'>('idle');
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

	React.useEffect(() => {
		if (!status.recording) return;
		const intervalId = window.setInterval(() => {
			const next = getScrollDiagStatus();
			setStatus(next);
			// Hit the recording time cap on its own.
			if (!next.recording) {
				setReport(formatScrollDiagReport());
				setCopied('idle');
			}
		}, 500);
		return () => window.clearInterval(intervalId);
	}, [status.recording]);

	React.useEffect(() => () => stopScrollDiag(), []);

	const start = React.useCallback(() => {
		setReport(null);
		startScrollDiag();
		setStatus(getScrollDiagStatus());
	}, []);

	const stop = React.useCallback(() => {
		stopScrollDiag();
		setStatus(getScrollDiagStatus());
		setReport(formatScrollDiagReport());
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

	if (!SCROLL_DIAG_ENABLED) return null;

	return (
		<div
			style={{
				position: 'fixed',
				left: 12,
				bottom: CARD_DIAG_ENABLED ? 56 : 12,
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
						<strong>scroll diag</strong>
						<span style={{ opacity: 0.8 }}>
							{(status.elapsedMs / 1000).toFixed(1)}s · {status.events} events
						</span>
						<span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
							<button type="button" onClick={start} style={buttonStyle}>record again</button>
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
			) : status.recording ? (
				<button type="button" onClick={stop} style={{ ...buttonStyle, padding: '8px 12px', borderColor: '#f85149' }}>
					■ stop · {Math.floor(status.elapsedMs / 1000)}s · {status.events} ev
				</button>
			) : (
				<button type="button" onClick={start} style={{ ...buttonStyle, padding: '8px 12px' }}>
					● scroll diag
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
