import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import {
	flushQueuedNoteLinkSync,
	getCachedRemoteNoteLinks,
	getNoteLinksChangedEventName,
	readStoredNoteLinks,
	refreshRemoteNoteLinks,
} from '../../core/noteLinkStore';
import type { NoteLinkRecord } from '../../core/noteLinkApi';
import type { ExtractedNoteLink } from '../../core/noteLinks';
import styles from './NoteLinkPanel.module.css';

type NoteLinkPanelProps = {
	docId: string;
	authUserId?: string | null;
	variant?: 'panel' | 'rail';
	maxItems?: number;
	fallbackLinks?: readonly ExtractedNoteLink[];
	canEdit?: boolean;
	onDeleteLink?: (normalizedUrl: string) => void;
	onAddUrlPreview?: (() => void) | undefined;
};

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function summarizeLink(link: NoteLinkRecord): string {
	return link.title || link.description || link.mainContent || link.rootDomain || link.originalUrl;
}

function isLikelyBadPreviewImageUrl(url: string | null | undefined): boolean {
	const value = String(url || '').trim().toLowerCase();
	if (!value) return true;
	if (value.includes('fls-na.amazon.') || value.includes('uedata=')) return true;
	if (value.includes('sprite') || value.includes('sash/') || value.endsWith('.svg')) return true;
	if (value.includes('transparent') || value.includes('pixel')) return true;
	return false;
}

function pickDisplayImageUrl(link: NoteLinkRecord): string | null {
	if (link.imageUrl && !isLikelyBadPreviewImageUrl(link.imageUrl)) return link.imageUrl;
	for (const candidate of link.imageUrls || []) {
		if (typeof candidate === 'string' && !isLikelyBadPreviewImageUrl(candidate)) {
			return candidate;
		}
	}
	return null;
}

function LinkPreviewImage(props: { link: NoteLinkRecord }): React.JSX.Element {
	const [failed, setFailed] = React.useState(false);
	const displayImageUrl = pickDisplayImageUrl(props.link);
	if (!displayImageUrl || failed) {
		return (
			<div className={styles.imagePlaceholder} aria-hidden="true">
				<FontAwesomeIcon icon={faLink} />
			</div>
		);
	}
	return (
		<img
			className={styles.image}
			src={displayImageUrl}
			alt=""
			loading="lazy"
			onError={() => setFailed(true)}
		/>
	);
}

function toFallbackRecords(docId: string, links: readonly ExtractedNoteLink[]): NoteLinkRecord[] {
	const timestamp = new Date().toISOString();
	return links.map((link) => ({
		id: `fallback:${link.normalizedUrl}`,
		docId,
		sourceWorkspaceId: '',
		sourceNoteId: '',
		normalizedUrl: link.normalizedUrl,
		originalUrl: link.url,
		hostname: link.hostname,
		rootDomain: link.rootDomain,
		siteName: link.rootDomain || null,
		title: null,
		description: null,
		mainContent: null,
		imageUrl: null,
		metadataJson: null,
		imageUrls: [],
		sortOrder: link.sortOrder,
		status: 'PENDING',
		errorMessage: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	}));
}

export function NoteLinkPanel(props: NoteLinkPanelProps): React.JSX.Element | null {
	const { t } = useI18n();
	const variant = props.variant || 'panel';
	const maxItems = Number.isFinite(props.maxItems) ? Math.max(1, Number(props.maxItems)) : (variant === 'rail' ? 3 : 100);
	const [links, setLinks] = React.useState<readonly NoteLinkRecord[]>(() => getCachedRemoteNoteLinks(props.docId));
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const summaryLabel = links.length === 1 ? `1 ${t('links.linkSingular')}` : `${links.length} ${t('links.linkPlural')}`;

	const refresh = React.useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const next = await refreshRemoteNoteLinks(props.docId).catch(async () => await readStoredNoteLinks(props.docId));
			setLinks(next);
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('links.loadFailed'));
			setLinks(await readStoredNoteLinks(props.docId));
		} finally {
			setLoading(false);
		}
	}, [props.docId, t]);

	React.useEffect(() => {
		void refresh();
	}, [refresh]);

	React.useEffect(() => {
		const eventName = getNoteLinksChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				void refresh();
			}
		};
		const onOnline = (): void => {
			if (props.authUserId) {
				void flushQueuedNoteLinkSync(props.authUserId);
			}
			void refresh();
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.authUserId, props.docId, refresh]);

	const resolvedLinks = React.useMemo(() => {
		if (links.length > 0) return links;
		return toFallbackRecords(props.docId, props.fallbackLinks || []);
	}, [links, props.docId, props.fallbackLinks]);
	const visibleLinks = React.useMemo(() => resolvedLinks.slice(0, maxItems), [resolvedLinks, maxItems]);

	if (variant === 'rail' && visibleLinks.length === 0) {
		return null;
	}

	return (
		<section className={variant === 'rail' ? styles.rail : styles.panel} aria-label={t('links.sectionTitle')}>
			{variant === 'panel' ? (
				<div className={styles.header}>
					<div>
						<p className={styles.eyebrow}>{t('editors.mediaTabLinks')}</p>
						<p className={styles.summary}>
							{visibleLinks.length === 0 ? t('links.emptyTitle') : summaryLabel}
						</p>
					</div>
					<div className={styles.headerActions}>
						{loading ? <span className={styles.status}>{t('common.loading')}</span> : null}
						{props.canEdit && props.onAddUrlPreview ? (
							<button type="button" className={styles.addButton} onClick={props.onAddUrlPreview}>
								<FontAwesomeIcon icon={faPlus} />
								<span>{t('links.addButton')}</span>
							</button>
						) : null}
					</div>
				</div>
			) : null}
			{error && variant === 'panel' ? <p className={styles.error}>{error}</p> : null}
			{visibleLinks.length === 0 ? null : (
				<div className={variant === 'rail' ? styles.railList : styles.list}>
					{visibleLinks.map((link) => (
						<div
							key={link.id}
							className={`${styles.card}${variant === 'rail' ? ` ${styles.cardCompact}` : ''}`}
						>
							{variant !== 'rail' && props.canEdit && props.onDeleteLink ? (
								<button
									type="button"
									className={styles.deleteButton}
									onClick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										props.onDeleteLink?.(link.normalizedUrl);
									}}
									aria-label={t('links.deletePreview')}
									title={t('links.deletePreview')}
								>
									<FontAwesomeIcon icon={faTrash} />
								</button>
							) : null}
							<a className={styles.cardLink} href={link.originalUrl} target="_blank" rel="noreferrer noopener">
							<LinkPreviewImage link={link} />
							<div className={styles.copy}>
								<p className={styles.description}>{summarizeLink(link)}</p>
								<p className={styles.domain}>{link.rootDomain || link.hostname || link.originalUrl}</p>
							</div>
							</a>
						</div>
					))}
				</div>
			)}
		</section>
	);
}