import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faImage } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import { filterRemoteNoteImagesByPendingDeletes, getCachedRemoteNoteImages, getNoteMediaChangedEventName, readQueuedNoteImageDeletions, readQueuedNoteImages, readStoredRemoteNoteImages, refreshRemoteNoteImages } from '../../core/noteMediaStore';

type NoteImageCountChipProps = {
	docId: string;
	authUserId?: string | null;
	className: string;
	onClick: () => void;
};

export function NoteImageCountChip(props: NoteImageCountChipProps): React.JSX.Element | null {
	const { t } = useI18n();
	const [count, setCount] = React.useState(0);

	const refresh = React.useCallback(async (options?: { syncRemote?: boolean; forceRemote?: boolean }) => {
		const [queued, queuedDeletes] = props.authUserId
			? await Promise.all([
				readQueuedNoteImages(props.authUserId, props.docId),
				readQueuedNoteImageDeletions(props.authUserId, props.docId),
			])
			: [[], []];
		const storedRemote = await readStoredRemoteNoteImages(props.docId);
		const cachedRemote = storedRemote.length > 0 ? storedRemote : getCachedRemoteNoteImages(props.docId);
		setCount(filterRemoteNoteImagesByPendingDeletes(cachedRemote, queuedDeletes).length + queued.length);

		if (!options?.syncRemote) return;
		try {
			// Chips need one lightweight server read on first paint so fresh devices
			// see real media counts without forcing the editor or media panel to open.
			const remoteImages = await refreshRemoteNoteImages(props.docId, {
				force: options.forceRemote,
				minIntervalMs: options.forceRemote ? 0 : 15_000,
			});
			setCount(filterRemoteNoteImagesByPendingDeletes(remoteImages, queuedDeletes).length + queued.length);
		} catch {
			// Keep the best local count when the server cannot be reached.
		}
	}, [props.authUserId, props.docId]);

	React.useEffect(() => {
		void refresh({ syncRemote: true });
	}, [refresh]);

	React.useEffect(() => {
		const eventName = getNoteMediaChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh({ syncRemote: true, forceRemote: true });
			}
		};
		const onOnline = (): void => {
			void refresh({ syncRemote: true, forceRemote: true });
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
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