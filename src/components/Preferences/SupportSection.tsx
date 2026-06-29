import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeart } from '@fortawesome/free-solid-svg-icons';
import styles from './SupportSection.module.css';

const PAYPAL_URL = 'https://paypal.me/DaxtonDay';
const BMC_URL = 'https://buymeacoffee.com/daxtond';

interface Supporter {
	id: string;
	name: string;
	avatarUrl: string | null;
	supporterSince: string | null;
}

interface Props {
	t: (key: string) => string;
	isSupporter: boolean;
	supporterShowPublic: boolean;
	onVisibilityChange: (showPublic: boolean) => void;
}

export function SupportSection({ t, isSupporter, supporterShowPublic, onVisibilityChange }: Props): React.JSX.Element {
	const [supporters, setSupporters] = React.useState<Supporter[]>([]);
	const [loading, setLoading] = React.useState(true);
	const [visibilityBusy, setVisibilityBusy] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		setLoading(true);
		fetch('/api/supporters')
			.then((r) => r.ok ? r.json() : null)
			.then((data) => {
				if (!cancelled && Array.isArray(data?.supporters)) {
					setSupporters(data.supporters);
				}
				if (!cancelled) setLoading(false);
			})
			.catch(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, []);

	const handleVisibilityToggle = React.useCallback(async () => {
		if (visibilityBusy) return;
		setVisibilityBusy(true);
		const next = !supporterShowPublic;
		try {
			const res = await fetch('/api/user/supporter-visibility', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ showPublic: next }),
			});
			if (res.ok) onVisibilityChange(next);
		} catch { /* network — ignore */ }
		setVisibilityBusy(false);
	}, [supporterShowPublic, visibilityBusy, onVisibilityChange]);

	return (
		<div className={styles.root}>
			<p className={styles.blurb}>{t('support.blurb')}</p>

			<div className={styles.buttons}>
				<a
					href={BMC_URL}
					target="_blank"
					rel="noopener noreferrer"
					className={`${styles.donateBtn} ${styles.donateBtnBmc}`}
				>
					☕ {t('support.buyMeACoffee')}
				</a>
				<a
					href={PAYPAL_URL}
					target="_blank"
					rel="noopener noreferrer"
					className={`${styles.donateBtn} ${styles.donateBtnPaypal}`}
				>
					💙 {t('support.paypal')}
				</a>
			</div>

			{isSupporter && (
				<div className={styles.supporterStatus}>
					<FontAwesomeIcon icon={faHeart} className={styles.heartIcon} />
					<span>{t('support.thankYou')}</span>
					<label className={styles.visibilityToggle}>
						<input
							type="checkbox"
							checked={supporterShowPublic}
							onChange={handleVisibilityToggle}
							disabled={visibilityBusy}
						/>
						{t('support.showOnContributors')}
					</label>
				</div>
			)}

			<div className={styles.contributorsSection}>
				<h4 className={styles.contributorsTitle}>
					<FontAwesomeIcon icon={faHeart} className={styles.heartIconSmall} />
					{t('support.contributorsTitle')}
				</h4>
				{loading ? (
					<p className={styles.loadingText}>{t('common.loading')}</p>
				) : supporters.length === 0 ? (
					<p className={styles.emptyText}>{t('support.contributorsEmpty')}</p>
				) : (
					<ul className={styles.contributorsList}>
						{supporters.map((s) => (
							<li key={s.id} className={styles.contributorRow}>
								<div className={styles.contributorAvatar}>
									{s.avatarUrl
										? <img src={s.avatarUrl} alt="" className={styles.contributorAvatarImg} />
										: <span className={styles.contributorAvatarFallback}>{s.name.slice(0, 1).toUpperCase()}</span>
									}
								</div>
								<span className={styles.contributorName}>{s.name}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
