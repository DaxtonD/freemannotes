import React from 'react';
import { getCachedAvatarUrl } from '../../core/userAvatarCache';
import type { PriorCollaboratorUser } from '../../core/priorCollaboratorsApi';
import styles from './PriorCollaboratorSuggestions.module.css';

type Props = {
	items: readonly PriorCollaboratorUser[];
	loading: boolean;
	emptyLabel: string;
	loadingLabel: string;
	onSelect: (user: PriorCollaboratorUser) => void;
};

function Avatar({ user }: { user: PriorCollaboratorUser }): React.JSX.Element {
	const [broken, setBroken] = React.useState(false);
	const src = !broken ? (user.profileImage || getCachedAvatarUrl(user.id) || null) : null;
	const initial = (user.name || user.email || user.id || '?').slice(0, 1).toUpperCase();

	React.useEffect(() => {
		setBroken(false);
	}, [user.id, user.profileImage]);

	if (!src) {
		return <div className={styles.avatarFallback} aria-hidden="true">{initial}</div>;
	}
	return <img className={styles.avatar} src={src} alt="" onError={() => setBroken(true)} />;
}

export function PriorCollaboratorSuggestions(props: Props): React.JSX.Element {
	return (
		<div className={styles.panel} role="listbox" aria-label={props.emptyLabel}>
			<div className={styles.list}>
				{props.loading ? <div className={styles.loading}>{props.loadingLabel}</div> : null}
				{!props.loading && props.items.length === 0 ? <div className={styles.empty}>{props.emptyLabel}</div> : null}
				{!props.loading ? props.items.map((user) => (
					<button
						key={`${user.id || user.email || user.name}`}
						type="button"
						className={styles.item}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => props.onSelect(user)}
					>
						<Avatar user={user} />
						<span className={styles.copy}>
							<span className={styles.primary}>{user.name || user.email || user.id}</span>
							{user.email && user.name ? <span className={styles.secondary}>{user.email}</span> : null}
						</span>
					</button>
				)) : null}
			</div>
		</div>
	);
}