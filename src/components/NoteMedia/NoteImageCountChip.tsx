import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { listNoteImages } from '../../core/noteMediaApi';
import { filterRemoteNoteImagesByPendingDeletes, getCachedRemoteNoteImages, getNoteMediaChangedEventName, readQueuedNoteImageDeletions, readQueuedNoteImages } from '../../core/noteMediaStore';

type NoteImageCountChipProps = {
	docId: string;
	authUserId?: string | null;
	className: string;
	onClick: () => void;
};

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function NoteImageCountChip(props: NoteImageCountChipProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [count, setCount] = React.useState(0);

	const refresh = React.useCallback(async () => {
		const [queued, queuedDeletes] = props.authUserId
			? await Promise.all([
				readQueuedNoteImages(props.authUserId, props.docId),
				readQueuedNoteImageDeletions(props.authUserId, props.docId),
			])
			: [[], []];
		if (isOffline()) {
			setCount(filterRemoteNoteImagesByPendingDeletes(getCachedRemoteNoteImages(props.docId), queuedDeletes).length + queued.length);
			return;
		}
		try {
			const response = await listNoteImages(props.docId);
			setCount(filterRemoteNoteImagesByPendingDeletes(response.images, queuedDeletes).length + queued.length);
		} catch {
			setCount(filterRemoteNoteImagesByPendingDeletes(getCachedRemoteNoteImages(props.docId), queuedDeletes).length + queued.length);
		}
	}, [props.authUserId, props.docId]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	React.useEffect(() => {
		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh();
			}
		};
		window.addEventListener(eventName, onChanged as EventListener);
		return () => window.removeEventListener(eventName, onChanged as EventListener);
	}, [props.docId, refresh]);

	if (count <= 0) return null;

	return (
		<button
			type="button"
			className={props.className}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				props.onClick();
			}}
			aria-label={`${count} ${count === 1 ? t('media.imageSingular') : t('media.imagePlural')}`}
		>
			<FontAwesomeIcon icon={faImage} />
			<span>{count}</span>
		</button>
	);
}