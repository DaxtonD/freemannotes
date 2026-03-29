import React from 'react';
import { fetchPushStatus, sendTestPushNotification, type PushSubscriptionStatus } from '../../core/pushApi';
import {
	getPlatform,
	isIosPlatform,
	isIosInstalled,
	isPushSupported,
	getNotificationPermission,
	subscribeToPush,
	unsubscribeFromPush,
	reregisterPush,
	type PushPermissionState,
} from '../../core/pushManager';
import styles from './NotificationsSection.module.css';

type ConnectionState = 'connected' | 'connecting' | 'offline';

export type NotificationsSectionProps = {
	t: (key: string) => string;
	deviceId: string;
	connectionState: ConnectionState;
};

type TestResult = { ok: boolean; message: string } | null;

/**
 * Formats a Unix-style ISO timestamp into a human-readable relative string.
 */
function formatRelativeTime(iso: string): string {
	try {
		const diff = Date.now() - new Date(iso).getTime();
		if (diff < 60_000) return 'just now';
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
		if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
		return `${Math.floor(diff / 86_400_000)}d ago`;
	} catch {
		return iso;
	}
}

export function NotificationsSection(props: NotificationsSectionProps): React.JSX.Element {
	const { t, deviceId, connectionState } = props;

	// ── Detected environment ────────────────────────────────────────────────
	const platform = React.useMemo(() => getPlatform(), []);
	const isIos = React.useMemo(() => isIosPlatform(), []);
	const iosInstalled = React.useMemo(() => isIosInstalled(), []);
	const pushSupported = React.useMemo(() => isPushSupported(), []);

	// ── Component state ─────────────────────────────────────────────────────
	const [permission, setPermission] = React.useState<PushPermissionState>(() => getNotificationPermission());
	const [status, setStatus] = React.useState<PushSubscriptionStatus | null>(null);
	const [loadingStatus, setLoadingStatus] = React.useState(true);
	const [statusError, setStatusError] = React.useState<string | null>(null);

	const [subscribing, setSubscribing] = React.useState(false);
	const [unsubscribing, setUnsubscribing] = React.useState(false);
	const [reregistering, setReregistering] = React.useState(false);
	const [testing, setTesting] = React.useState(false);
	const [testResult, setTestResult] = React.useState<TestResult>(null);
	const [actionError, setActionError] = React.useState<string | null>(null);

	// Keep a ref so loadStatus can read the current connectionState without
	// being in its dependency array (avoids re-fetching on every WS flap).
	const connectionStateRef = React.useRef(connectionState);
	connectionStateRef.current = connectionState;

	// ── Load subscription status ────────────────────────────────────────────
	const loadStatus = React.useCallback(async () => {
		if (!deviceId || connectionStateRef.current === 'offline') {
			setLoadingStatus(false);
			return;
		}
		try {
			setLoadingStatus(true);
			setStatusError(null);
			const data = await fetchPushStatus(deviceId);
			setStatus(data);
		} catch (err) {
			setStatusError(err instanceof Error ? err.message : 'Failed to load push status');
		} finally {
			setLoadingStatus(false);
		}
	}, [deviceId]); // connectionState intentionally omitted — read via ref to avoid re-fetch on every WS flap

	React.useEffect(() => {
		void loadStatus();
	}, [loadStatus]);

	// Refresh permission state on mount (browsers may update it asynchronously)
	React.useEffect(() => {
		setPermission(getNotificationPermission());
	}, []);

	// ── Derived booleans ────────────────────────────────────────────────────
	const isSubscribed = Boolean(status?.subscription?.enabled);
	const isAnyActionBusy = subscribing || unsubscribing || reregistering || testing;

	// Reset test result when re-testing
	function clearFeedback() {
		setTestResult(null);
		setActionError(null);
	}

	// ── Enable push ─────────────────────────────────────────────────────────
	async function handleEnable() {
		if (!deviceId) return;
		clearFeedback();
		setSubscribing(true);
		try {
			const newPermission = await subscribeToPush(deviceId);
			setPermission(newPermission);
			if (newPermission === 'granted') {
				await loadStatus();
			}
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Subscription failed');
		} finally {
			setSubscribing(false);
		}
	}

	// ── Disable push ────────────────────────────────────────────────────────
	async function handleDisable() {
		if (!deviceId) return;
		clearFeedback();
		setUnsubscribing(true);
		try {
			await unsubscribeFromPush(deviceId);
			await loadStatus();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Unsubscription failed');
		} finally {
			setUnsubscribing(false);
		}
	}

	// ── Re-register ─────────────────────────────────────────────────────────
	async function handleReregister() {
		if (!deviceId) return;
		clearFeedback();
		setReregistering(true);
		try {
			const newPermission = await reregisterPush(deviceId);
			setPermission(newPermission);
			await loadStatus();
		} catch (err) {
			setActionError(err instanceof Error ? err.message : 'Re-registration failed');
		} finally {
			setReregistering(false);
		}
	}

	// ── Test notification ───────────────────────────────────────────────────
	async function handleTest() {
		clearFeedback();
		setTesting(true);
		try {
			const result = await sendTestPushNotification();
			if (result.sent > 0) {
				setTestResult({ ok: true, message: `Sent to ${result.sent} device${result.sent !== 1 ? 's' : ''}. Check your notifications.` });
			} else if (result.failed > 0) {
				setTestResult({ ok: false, message: `Failed to send (${result.failed} device${result.failed !== 1 ? 's' : ''} failed). Check server logs.` });
			} else {
				setTestResult({ ok: false, message: 'No devices to send to. Enable notifications first.' });
			}
			// Refresh logs to show the test attempt
			await loadStatus();
		} catch (err) {
			setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
		} finally {
			setTesting(false);
		}
	}

	// ── Offline state ───────────────────────────────────────────────────────
	if (connectionState === 'offline') {
		return (
			<div className={styles.notificationsSection}>
				<div className={styles.offlineNotice}>
					{t('common.offline') || 'You are offline. Connect to manage push notifications.'}
				</div>
			</div>
		);
	}

	// ── iOS-in-browser block (not installed) ────────────────────────────────
	// Web Push on iOS Safari requires the app to be added to the Home Screen first.
	const showIosGuidance = isIos && !iosInstalled;

	return (
		<div className={styles.notificationsSection}>

			{/* ── Subscription status card ─────────────────────────────── */}
			<div className={styles.statusCard}>
				{loadingStatus ? (
					<div className={styles.loading}>{t('common.loading') || 'Loading…'}</div>
				) : statusError ? (
					<div className={styles.errorBox}>{statusError}</div>
				) : (
					<>
						<div className={styles.statusRow}>
							<span
								className={`${styles.statusDot} ${
									isSubscribed
										? styles.statusDotEnabled
										: permission === 'denied'
											? styles.statusDotDisabled
											: styles.statusDotUnknown
								}`}
							/>
							<span className={styles.statusLabel}>
								{isSubscribed
									? (t('push.statusEnabled') || 'Push notifications enabled')
									: permission === 'denied'
										? (t('push.statusDenied') || 'Notifications blocked by browser')
										: (t('push.statusDisabled') || 'Push notifications disabled')}
							</span>
						</div>

						<div className={styles.statusRow}>
							<span className={styles.statusPlatformBadge}>{platform}</span>
							{status?.subscription?.lastSeenAt && (
								<span className={styles.statusMeta}>
									{t('push.lastSync') || 'Last sync'}: {formatRelativeTime(status.subscription.lastSeenAt)}
								</span>
							)}
						</div>
					</>
				)}
			</div>

			{/* ── iOS guidance (not yet installed to Home Screen) ──────── */}
			{showIosGuidance && (
				<div className={styles.iosGuidance}>
					<div className={styles.iosGuidanceTitle}>
						{t('push.iosGuidanceTitle') || '📱 Add to Home Screen Required'}
					</div>
					<ol className={styles.iosGuidanceSteps}>
						<li className={styles.iosGuidanceStep}>
							{t('push.iosStep1') || 'Tap the Share button (□↑) in Safari'}
						</li>
						<li className={styles.iosGuidanceStep}>
							{t('push.iosStep2') || 'Select "Add to Home Screen"'}
						</li>
						<li className={styles.iosGuidanceStep}>
							{t('push.iosStep3') || 'Open the app from your Home Screen'}
						</li>
						<li className={styles.iosGuidanceStep}>
							{t('push.iosStep4') || 'Return here and enable notifications'}
						</li>
					</ol>
					<div className={styles.iosWarning}>
						{t('push.iosDontAllow') || '⚠️ Do NOT tap "Don\'t Allow" — iOS cannot re-prompt after denial without resetting Safari settings.'}
					</div>
				</div>
			)}

			{/* ── Permission denied notice ──────────────────────────────── */}
			{permission === 'denied' && !showIosGuidance && (
				<div className={styles.deniedWarning}>
					{t('push.permissionDenied') || 'Notifications are blocked. To re-enable, open your browser or OS settings and allow notifications for this site.'}
				</div>
			)}

			{/* ── Actions ──────────────────────────────────────────────── */}
			{!showIosGuidance && (
				<div className={styles.actions}>
					{!isSubscribed && permission !== 'denied' && pushSupported && (
						<button
							type="button"
							className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
							onClick={handleEnable}
							disabled={isAnyActionBusy}
						>
							<span className={styles.actionIcon}>🔔</span>
							{subscribing
								? (t('common.loading') || 'Enabling…')
								: (t('push.enableNotifications') || 'Enable Notifications')}
						</button>
					)}

					{isSubscribed && (
						<>
							<button
								type="button"
								className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
								onClick={handleDisable}
								disabled={isAnyActionBusy}
							>
								<span className={styles.actionIcon}>🔕</span>
								{unsubscribing
									? (t('common.loading') || 'Disabling…')
									: (t('push.disableNotifications') || 'Disable Notifications')}
							</button>

							<button
								type="button"
								className={styles.actionBtn}
								onClick={handleReregister}
								disabled={isAnyActionBusy}
							>
								<span className={styles.actionIcon}>🔄</span>
								{reregistering
									? (t('common.loading') || 'Re-registering…')
									: (t('push.reregister') || 'Re-register Device')}
							</button>

							<button
								type="button"
								className={styles.actionBtn}
								onClick={handleTest}
								disabled={isAnyActionBusy || connectionState !== 'connected'}
							>
								<span className={styles.actionIcon}>📨</span>
								{testing
									? (t('common.loading') || 'Sending…')
									: (t('push.sendTest') || 'Send Test Notification')}
							</button>
						</>
					)}
				</div>
			)}

			{/* ── Action feedback ───────────────────────────────────────── */}
			{actionError && (
				<div className={styles.errorBox}>{actionError}</div>
			)}

			{testResult && (
				<div className={`${styles.testResult} ${testResult.ok ? styles.testResultSuccess : styles.testResultFail}`}>
					{testResult.ok ? '✓' : '✕'} {testResult.message}
				</div>
			)}

			{/* ── Recent delivery log ───────────────────────────────────── */}
			{!loadingStatus && status?.recentLogs && status.recentLogs.length > 0 && (
				<div className={styles.healthSection}>
					<p className={styles.healthTitle}>{t('push.recentDeliveries') || 'Recent Deliveries'}</p>
					<div className={styles.logList}>
						{status.recentLogs.map((log, index) => (
							<div key={index} className={styles.logRow}>
								<span className={`${styles.logStatus} ${log.status === 'sent' ? styles.logStatusSent : styles.logStatusFailed}`}>
									{log.status === 'sent' ? '✓' : '✕'} {log.status}
								</span>
								<span className={styles.logType} title={log.error ?? log.title}>
									{log.type}
								</span>
								{log.latencyMs != null && (
									<span className={styles.logLatency}>{log.latencyMs}ms</span>
								)}
								<span className={styles.statusMeta}>{formatRelativeTime(log.sentAt)}</span>
							</div>
						))}
					</div>
				</div>
			)}

			{!loadingStatus && status?.recentLogs && status.recentLogs.length === 0 && isSubscribed && (
				<div className={styles.healthSection}>
					<p className={styles.healthTitle}>{t('push.recentDeliveries') || 'Recent Deliveries'}</p>
					<p className={styles.noLogs}>{t('push.noDeliveries') || 'No deliveries yet. Send a test notification above.'}</p>
				</div>
			)}
		</div>
	);
}
