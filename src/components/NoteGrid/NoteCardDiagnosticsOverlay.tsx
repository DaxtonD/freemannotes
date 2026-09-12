import React from 'react';
import {
	CARD_DIAG_ENABLED,
	captureNoteCardDiag,
	formatNoteCardDiagReport,
	type NoteCardDiagRow,
} from '../../core/noteCardDiagnostics';

/**
 * Floating capture panel for the `?cardDiag=1` note-card height diagnostics.
 *
 * Deliberately renders the report into a selectable <textarea> as well as trying
 * the clipboard: the dev server is plain http over the LAN when testing on a
 * phone, and navigator.clipboard is unavailable outside a secure context there.
 * The textarea is the path that always works (long-press → select all → copy).
 *
 * Anchored bottom-LEFT so it never sits under the mobile FAB.
 */
export function NoteCardDiagnosticsOverlay(): React.JSX.Element | null {
	const [open, setOpen] = React.useState(false);
	const [report, setReport] = React.useState('');
	const [rows, setRows] = React.useState<readonly NoteCardDiagRow[]>([]);
	const [copied, setCopied] = React.useState<'idle' | 'ok' | 'fail'>('idle');
	const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

	const runCapture = React.useCallback(() => {
		const captured = captureNoteCardDiag();
		setRows(captured);
		setReport(formatNoteCardDiagReport(captured));
		setCopied('idle');
		setOpen(true);
	}, []);

	const copyReport = React.useCallback(() => {
		const node = textareaRef.current;
		if (node) {
			node.focus();
			node.select();
		}
		void (async () => {
			try {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(report);
					setCopied('ok');
					return;
				}
			} catch {
				// fall through to the manual path below
			}
			setCopied('fail');
		})();
	}, [report]);

	if (!CARD_DIAG_ENABLED) return null;

	const lossCount = rows.filter((r) => r.severity === 'content-loss').length;
	const cosmeticCount = rows.filter((r) => r.severity === 'cosmetic').length;

	return (
		<div
			style={{
				position: 'fixed',
				left: 12,
				bottom: 12,
				zIndex: 99999,
				fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
				fontSize: 12,
			}}
		>
			{open ? (
				<div
					style={{
						width: 'min(92vw, 560px)',
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
						<strong style={{ fontSize: 12 }}>card diag</strong>
						<span style={{ opacity: 0.8 }}>
							{rows.length} cards ·{' '}
							<span style={{ color: lossCount > 0 ? '#f85149' : 'inherit' }}>{lossCount} content-loss</span>
							{' · '}
							{cosmeticCount} cosmetic
						</span>
						<span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
							<button type="button" onClick={runCapture} style={buttonStyle}>recapture</button>
							<button type="button" onClick={copyReport} style={buttonStyle}>
								{copied === 'ok' ? 'copied' : copied === 'fail' ? 'select+copy' : 'copy'}
							</button>
							<button type="button" onClick={() => setOpen(false)} style={buttonStyle}>close</button>
						</span>
					</div>
					{copied === 'fail' ? (
						<div style={{ color: '#f0b72f' }}>
							Clipboard blocked (http). Text is selected — use your copy gesture.
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
				<button type="button" onClick={runCapture} style={{ ...buttonStyle, padding: '8px 12px' }}>
					card diag
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
