import React from 'react';
import styles from './PublicSharePage.module.css';

type SharedChecklistItem = {
	id?: string;
	text?: string;
	completed?: boolean;
};

type SharedSnapshot = {
	title?: string;
	content?: string;
	checklist?: SharedChecklistItem[];
};

type Props = {
	t: (key: string) => string;
	token: string;
	onExit: () => void;
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
	const res = await fetch(input, init);
	const contentType = String(res.headers.get('content-type') || '').toLowerCase();
	const body = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
	if (!res.ok) {
		const message = body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
		throw new Error(message);
	}
	return body as T;
}

function formatDate(value: string | null | undefined): string {
	if (!value) return '';
	const ms = Date.parse(value);
	if (!Number.isFinite(ms)) return value;
	return new Date(ms).toLocaleString();
}

export function PublicSharePage(props: Props): React.JSX.Element {
	const [busy, setBusy] = React.useState(true);
	const [error, setError] = React.useState<string | null>(null);
	const [snapshot, setSnapshot] = React.useState<SharedSnapshot | null>(null);
	const [expiresAt, setExpiresAt] = React.useState<string | null>(null);
	const [updatedAt, setUpdatedAt] = React.useState<string | null>(null);

	const load = React.useCallback(async () => {
		// Public share snapshots are fetched by token only. This route deliberately
		// avoids workspace auth assumptions so recipients can preview the shared note
		// in a read-only shell even when they do not belong to the source workspace.
		setBusy(true);
		setError(null);
		try {
			const body = await fetchJson<{ snapshot?: SharedSnapshot; expiresAt?: string; updatedAt?: string }>(`/api/share/${encodeURIComponent(props.token)}`);
			setSnapshot(body?.snapshot ?? null);
			setExpiresAt(typeof body?.expiresAt === 'string' ? body.expiresAt : null);
			setUpdatedAt(typeof body?.updatedAt === 'string' ? body.updatedAt : null);
		} catch (err) {
			setError(err instanceof Error ? err.message : props.t('share.loadFailed'));
		} finally {
			setBusy(false);
		}
	}, [props]);

	React.useEffect(() => {
		void load();
	}, [load]);

	const title = snapshot?.title?.trim() || props.t('note.untitled');
	const content = snapshot?.content?.trim() || '';
	const checklist = Array.isArray(snapshot?.checklist) ? snapshot?.checklist : [];

	return (
		<div className={styles.page}>
			<section className={styles.card}>
				<p className={styles.eyebrow}>{props.t('share.publicTitle')}</p>
				<h1 className={styles.title}>{title}</h1>
				<div className={styles.meta}>
					{expiresAt ? <span>{props.t('share.expiresAt')}: {formatDate(expiresAt)}</span> : null}
					{updatedAt ? <span>{props.t('share.updatedAt')}: {formatDate(updatedAt)}</span> : null}
				</div>

				{/* Rendering is mutually exclusive by state: loading, error, then the
				   hydrated snapshot body/checklist once the token request succeeds. */}
				{busy ? <div className={styles.body}>{props.t('common.loading')}</div> : null}
				{error ? <div className={styles.error}>{error}</div> : null}

				{!busy && !error && content ? <div className={styles.body}>{content}</div> : null}
				{!busy && !error && checklist.length > 0 ? (
					<ul className={styles.checklist}>
						{checklist.map((item, index) => {
							const text = typeof item?.text === 'string' ? item.text : '';
							const completed = Boolean(item?.completed);
							return (
								<li key={item?.id || `${index}`} className={`${styles.checklistItem}${completed ? ` ${styles.checklistItemCompleted}` : ''}`}>
									<span className={styles.checklistBullet} aria-hidden="true" />
									<span className={styles.checklistText}>{text || props.t('note.untitled')}</span>
								</li>
							);
						})}
					</ul>
				) : null}

				<div className={styles.actions}>
					<button type="button" onClick={() => void load()} disabled={busy}>
						{busy ? props.t('common.loading') : props.t('share.refresh')}
					</button>
					<button type="button" onClick={props.onExit}>{props.t('share.backToApp')}</button>
				</div>
			</section>
		</div>
	);
}