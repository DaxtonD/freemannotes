import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useI18n } from '../../core/i18n';
import {
	flushQueuedNoteLinkSync,
	getCachedRemoteNoteLinks,
	getNoteLinksChangedEventName,
	getQueuedIntentUrls,
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
	initialLinks?: readonly NoteLinkRecord[];
	canEdit?: boolean;
	disableOpenLinks?: boolean;
	onDeleteLink?: (normalizedUrl: string) => void;
	onAddUrlPreview?: (() => void) | undefined;
	disableInitialRemoteRefresh?: boolean;
};

// Generous retry schedule so the client keeps polling even when the first flush/GET
// fails because the network is not fully stable yet after reconnect.
const REMOTE_HYDRATION_RETRY_DELAYS_MS = [800, 1500, 3000, 5000, 8000, 12000];

// Small delay before the first flush after an `online` event to let the network
// connection stabilize (DNS, TLS handshakes, etc.).
const ONLINE_STABILISATION_DELAY_MS = 600;

function isOffline(): boolean {
	return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => { window.setTimeout(resolve, ms); });
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

function needsRemoteHydration(links: readonly NoteLinkRecord[]): boolean {
	// Only PENDING rows need hydration. FAILED means the server attempted
	// resolution and the URL couldn't be fetched (paywall, bot-block, etc.) –
	// treat it as terminal and show the basic fallback card instead of looping.
	return links.some((link) => link.status === 'PENDING');
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

function mergeResolvedLinks(
	remoteLinks: readonly NoteLinkRecord[],
	fallbackLinks: readonly NoteLinkRecord[]
): readonly NoteLinkRecord[] {
	if (fallbackLinks.length === 0) return remoteLinks;
	if (remoteLinks.length === 0) return fallbackLinks;
	const merged = new Map<string, NoteLinkRecord>();
	for (const link of remoteLinks) {
		merged.set(link.normalizedUrl, link);
	}
	for (const link of fallbackLinks) {
		if (!merged.has(link.normalizedUrl)) {
			merged.set(link.normalizedUrl, link);
		}
	}
	return Array.from(merged.values()).sort((left, right) => {
		const sortDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
		if (sortDiff !== 0) return sortDiff;
		return String(left.createdAt || '').localeCompare(String(right.createdAt || ''));
	});
}

export function NoteLinkPanel(props: NoteLinkPanelProps): React.JSX.Element | null {
	const { t } = useI18n();
	const variant = props.variant || 'panel';
	const maxItems = Number.isFinite(props.maxItems) ? Math.max(1, Number(props.maxItems)) : (variant === 'rail' ? 3 : 100);
	const [links, setLinks] = React.useState<readonly NoteLinkRecord[]>(() => {
		const cached = getCachedRemoteNoteLinks(props.docId);
		return cached.length > 0 ? cached : (props.initialLinks ?? []);
	});
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const retryTimerRef = React.useRef<number | null>(null);
	const retryAttemptRef = React.useRef(0);
	const fallbackSignature = React.useMemo(
		() => (props.fallbackLinks || []).map((link) => `${link.normalizedUrl}:${link.sortOrder}`).join('|'),
		[props.fallbackLinks]
	);
	const initialLinksSignature = React.useMemo(
		() => (props.initialLinks || []).map((link) => `${link.normalizedUrl}:${link.imageUrl || ''}:${link.sortOrder}`).join('|'),
		[props.initialLinks]
	);
	const summaryLabel = links.length === 1 ? `1 ${t('links.linkSingular')}` : `${links.length} ${t('links.linkPlural')}`;
	const fallbackCount = props.fallbackLinks?.length || 0;

	const clearRetryTimer = React.useCallback(() => {
		if (retryTimerRef.current !== null) {
			window.clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
		retryAttemptRef.current = 0;
	}, []);

	const syncFromCache = React.useCallback(async () => {
		const stored = await readStoredNoteLinks(props.docId).catch(() => getCachedRemoteNoteLinks(props.docId));
		setLinks(stored.length > 0 ? stored : getCachedRemoteNoteLinks(props.docId));
	}, [props.docId]);

	// --- Flush-then-refresh helper used by retries and the online handler ---
	// Each retry re-attempts the flush so that if the initial sync POST failed
	// (common when the network has just come back online), subsequent retries
	// push queued snapshots to the server before the GET that triggers hydration.
	const flushAndRefresh = React.useCallback(async (options: { force?: boolean; retryIfIncomplete?: boolean; showLoading?: boolean; retryAttempt?: number } = {}) => {
		if (props.authUserId) {
			await flushQueuedNoteLinkSync(props.authUserId).catch(() => undefined);
		}
		if (options.showLoading) {
			setLoading(true);
		}
		setError(null);
		try {
			// If a snapshot is still queued after the flush (flush failed silently),
			// honour its URL intent so that locally-deleted links don't reappear.
			const intentUrls = props.authUserId
				? await getQueuedIntentUrls(props.authUserId, props.docId).catch(() => null)
				: null;
			const next = await refreshRemoteNoteLinks(props.docId, { force: options.force, intentUrls }).catch(async () => await readStoredNoteLinks(props.docId));
			const shouldKeepVisibleRail = variant === 'rail' && next.length === 0 && fallbackCount > 0;
			setLinks((previous) => shouldKeepVisibleRail ? previous : next);
			if (options.retryIfIncomplete) {
				const shouldRetry = next.length === 0
					? fallbackCount > 0
					: needsRemoteHydration(next);
				if (shouldRetry) {
					const attempt = Math.max(0, options.retryAttempt ?? 0);
					const retryDelay = REMOTE_HYDRATION_RETRY_DELAYS_MS[attempt] ?? null;
					if (retryDelay !== null) {
						if (retryTimerRef.current !== null) {
							window.clearTimeout(retryTimerRef.current);
						}
						retryAttemptRef.current = attempt + 1;
						retryTimerRef.current = window.setTimeout(() => {
							retryTimerRef.current = null;
							// Use the ref so the callback always calls the latest version
							// (survives React effect re-subscriptions without stale closures).
							void flushAndRefreshRef.current({ force: true, retryIfIncomplete: true, retryAttempt: attempt + 1 });
						}, retryDelay);
					}
				} else if (retryTimerRef.current !== null || retryAttemptRef.current > 0) {
					clearRetryTimer();
				}
			} else if (retryTimerRef.current !== null || retryAttemptRef.current > 0) {
				clearRetryTimer();
			}
		} catch (nextError) {
			setError(nextError instanceof Error ? nextError.message : t('links.loadFailed'));
			setLinks(await readStoredNoteLinks(props.docId));
		} finally {
			if (options.showLoading) {
				setLoading(false);
			}
		}
	}, [clearRetryTimer, fallbackCount, props.authUserId, props.docId, t, variant]);

	// Stable ref so retry timer callbacks always use the latest version of the
	// function without being invalidated by React effect cleanup.
	const flushAndRefreshRef = React.useRef(flushAndRefresh);
	flushAndRefreshRef.current = flushAndRefresh;

	// Light-weight refresh (no flush) for events that only need a cache read or
	// a single GET without re-syncing queued data.
	const refresh = React.useCallback(async (options: { force?: boolean; retryIfIncomplete?: boolean; showLoading?: boolean } = {}) => {
		await flushAndRefresh({ ...options, retryAttempt: 0 });
	}, [flushAndRefresh]);

	React.useEffect(() => {
		if ((props.initialLinks?.length || 0) === 0) return;
		setLinks((current) => current.length > 0 ? current : (props.initialLinks || []));
	}, [initialLinksSignature, props.initialLinks]);

	React.useEffect(() => {
		if (props.disableInitialRemoteRefresh) {
			void readStoredNoteLinks(props.docId)
				.then((next) => {
					const cached = next.length > 0 ? next : getCachedRemoteNoteLinks(props.docId);
					setLinks(cached);
					if ((props.fallbackLinks?.length || 0) > 0 && !isOffline() && (cached.length === 0 || needsRemoteHydration(cached))) {
						void refresh({ force: true, retryIfIncomplete: true });
					}
				})
				.catch(() => {
					const cached = getCachedRemoteNoteLinks(props.docId);
					setLinks(cached);
					if ((props.fallbackLinks?.length || 0) > 0 && !isOffline() && (cached.length === 0 || needsRemoteHydration(cached))) {
						void refresh({ force: true, retryIfIncomplete: true });
					}
				});
			return;
		}
		void refresh({ showLoading: true });
	}, [props.disableInitialRemoteRefresh, props.docId, props.fallbackLinks, refresh]);

	React.useEffect(() => {
		if (!props.disableInitialRemoteRefresh) return;
		if ((props.fallbackLinks?.length || 0) === 0) return;
		if (isOffline()) return;
		void readStoredNoteLinks(props.docId)
			.then((next) => {
				const cached = next.length > 0 ? next : getCachedRemoteNoteLinks(props.docId);
				setLinks(cached);
				if (cached.length === 0 || needsRemoteHydration(cached)) {
					void refresh({ force: true, retryIfIncomplete: true });
				}
			})
			.catch(() => {
				const cached = getCachedRemoteNoteLinks(props.docId);
				setLinks(cached);
				if (cached.length === 0 || needsRemoteHydration(cached)) {
					void refresh({ force: true, retryIfIncomplete: true });
				}
			});
	}, [fallbackSignature, props.disableInitialRemoteRefresh, props.docId, props.fallbackLinks, refresh]);

	React.useEffect(() => {
		const eventName = getNoteLinksChangedEventName();
		const onChanged = (event: Event): void => {
			const detail = (event as CustomEvent<{ docId?: string; reason?: 'cache' | 'remote' }>).detail;
			if (!detail?.docId || detail.docId === props.docId) {
				if (detail?.reason === 'remote') {
					void refresh({ force: true, retryIfIncomplete: true });
					return;
				}
				void syncFromCache();
			}
		};
		const onOnline = (): void => {
			void (async () => {
				// Let the network connection stabilize before making requests;
				// the `online` event fires as soon as connectivity is detected but
				// DNS / TLS negotiation may still be in progress.
				await delay(ONLINE_STABILISATION_DELAY_MS);
				await flushAndRefreshRef.current({ force: true, retryIfIncomplete: true });
			})();
		};
		window.addEventListener(eventName, onChanged as EventListener);
		window.addEventListener('online', onOnline);
		return () => {
			// Do NOT clear the retry timer here – the timer callback uses the
			// stable flushAndRefreshRef and must survive effect re-subscriptions
			// caused by Yjs transactions changing fallbackLinks references.
			window.removeEventListener(eventName, onChanged as EventListener);
			window.removeEventListener('online', onOnline);
		};
	}, [props.authUserId, props.docId, refresh, syncFromCache]);

	// Clear the retry timer only on true unmount, not on effect re-subscription.
	React.useEffect(() => {
		return () => { clearRetryTimer(); };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const resolvedLinks = React.useMemo(() => {
		const fallbackRecords = toFallbackRecords(props.docId, props.fallbackLinks || []);
		return mergeResolvedLinks(links, fallbackRecords);
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
							{props.disableOpenLinks ? (
								<div className={styles.cardLink}>
									<LinkPreviewImage link={link} />
									<div className={styles.copy}>
										<p className={styles.description}>{summarizeLink(link)}</p>
										<p className={styles.domain}>{link.rootDomain || link.hostname || link.originalUrl}</p>
									</div>
								</div>
							) : (
								<a className={styles.cardLink} href={link.originalUrl} target="_blank" rel="noreferrer noopener">
									<LinkPreviewImage link={link} />
									<div className={styles.copy}>
										<p className={styles.description}>{summarizeLink(link)}</p>
										<p className={styles.domain}>{link.rootDomain || link.hostname || link.originalUrl}</p>
									</div>
								</a>
							)}
						</div>
					))}
				</div>
			)}
		</section>
	);
}