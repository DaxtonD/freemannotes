/**
 * Sync timing probe (`?syncDiag=1`).
 *
 * Opening the app currently opens one WebSocket per note in the workspace, each of which
 * costs a permission check and a workspace-scoped Postgres read on the server. At 86 notes
 * through Cloudflare that takes long enough that the grid's five-second patience
 * (SHIMMER_STALL_TIMEOUT_MS) runs out and it paints empty cards, and the note you actually
 * open is one of N waiting its turn. That story is read off the code; before rebuilding
 * anything around it we want the real numbers from a real device on a real network.
 *
 * The question this exists to answer is specifically WHERE the time goes, because the three
 * possible answers point at completely different work:
 *
 *   requested -> wsCreated   our own code queuing (nobody to blame but us)
 *   wsCreated -> connected   handshake: browser socket ceiling, Cloudflare, nginx
 *   connected -> synced      server: auth query + Postgres state read + sync step 1/2
 *
 * Unlike the other recorders this one STARTS ITSELF on page load, because the window of
 * interest is the boot and you cannot press Record before the thing you want to record.
 *
 * Deliberately not built on DEBUG_LOGGING: that POSTs client events to the server and
 * appends them to a file, which gets dramatically slower as the file grows (~115x was
 * measured once) — it would manufacture the very latency we are trying to measure.
 * Everything here stays in memory until the report is asked for.
 *
 * Runtime flag, sticky per browser, same mechanism as `?cardDiag=1` / `?scrollDiag=1`. Safe
 * to ship: every hook returns on its first line when the flag is off.
 */

import { readStickyDiagToggle } from './noteCardDiagnostics';

export const SYNC_DIAG_ENABLED = readStickyDiagToggle('syncDiag', 'freemannotes.syncDiag');

type RoomRecord = {
	room: string;
	/** Every timestamp is ms since page load (performance.now), so they double as a timeline. */
	requestedAt: number | null;
	idbReadyAt: number | null;
	wsCreatedAt: number | null;
	connectingAt: number | null;
	connectedAt: number | null;
	syncedAt: number | null;
	hadIdbContent: boolean | null;
	connects: number;
	disconnects: number;
	closes: number;
	lastCloseCode: number | null;
	errors: number;
	watchdogRescues: number;
	/** How many times a provider has been constructed for this room (destroy/recreate shows up here). */
	providerCreations: number;
	/** How many times the room has been torn down. */
	destroys: number;
	/** `connect:` passed to the FIRST provider constructed for this room. */
	createdWithConnect: boolean | null;
	/**
	 * Whether this room is currently counted in `connectingCount`.
	 *
	 * The first version incremented on `connecting` and decremented on
	 * `connected`/`disconnected`, which leaked badly: the 1.21.1 resume report showed 494
	 * "connecting" across 98 rooms, because y-websocket fires `connection-close` without
	 * always following it with a `disconnected` status (the same report proves it — rooms with
	 * `closes=5` and `disconnects=1`). Pairing the gauge to a per-room flag makes the number
	 * mean what it says.
	 */
	countedConnecting: boolean;
	/** Mirrors countedConnecting for the OPEN gauge. See the leak note in recordSyncDiagStatus. */
	countedOpen: boolean;
	/** Why this room's provider went away, most recent first use. */
	destroyReasons: string[];
	/** Whether this room is SUPPOSED to hold a socket. null = never asked. */
	wantsConnection: boolean | null;
};

type Mark = { name: string; at: number; detail?: string };

const MAX_ROOMS = 5000;
const MAX_MARKS = 500;
const MAX_PENDING_TRACE = 200;

/**
 * Every decision the pending-change system makes, in order.
 *
 * It lives in THIS report rather than in `console.log` because that is the difference between one
 * paste and a hunt through a console on a phone. The questions it has to answer are always the
 * same: did we see the change at all, were we armed, who did we think did it, and did an entry
 * survive. Each of those has silently swallowed a change at least once.
 */
type PendingTraceEntry = { at: number; kind: string; detail: string };
const pendingTrace: PendingTraceEntry[] = [];

function formatTraceDetail(detail?: Record<string, unknown>): string {
	if (!detail) return '';
	const parts: string[] = [];
	for (const [key, value] of Object.entries(detail)) {
		if (value === undefined) continue;
		const text = Array.isArray(value)
			? `[${value.map((item) => String(item).slice(0, 8)).join(',')}]`
			: String(value);
		parts.push(`${key}=${text}`);
	}
	return parts.join(' ');
}

/**
 * Record one pending-change decision. Cheap and a no-op unless ?syncDiag=1 is on.
 *
 * `kind` is a short stable slug so the log can be grepped; put the varying parts in `detail`.
 */
export function recordPendingChangeTrace(kind: string, detail?: Record<string, unknown>): void {
	if (!SYNC_DIAG_ENABLED) return;
	if (pendingTrace.length >= MAX_PENDING_TRACE) return;
	pendingTrace.push({ at: Math.round(now()), kind, detail: formatTraceDetail(detail) });
}
const CONCURRENCY_SAMPLE_MS = 250;
const MAX_CONCURRENCY_SAMPLES = 2400;

const rooms = new Map<string, RoomRecord>();
const marks: Mark[] = [];

let openCount = 0;
let connectingCount = 0;
let maxOpen = 0;
let maxConnecting = 0;
/** [tMs, connecting, open], sampled on a timer so queuing behaviour over the boot is visible. */
const concurrencySamples: Array<[number, number, number]> = [];
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let startedAt = 0;

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function ensureRoom(room: string): RoomRecord | null {
	const existing = rooms.get(room);
	if (existing) return existing;
	if (rooms.size >= MAX_ROOMS) return null;
	const record: RoomRecord = {
		room,
		requestedAt: null,
		idbReadyAt: null,
		wsCreatedAt: null,
		connectingAt: null,
		connectedAt: null,
		syncedAt: null,
		hadIdbContent: null,
		connects: 0,
		disconnects: 0,
		closes: 0,
		lastCloseCode: null,
		errors: 0,
		watchdogRescues: 0,
		providerCreations: 0,
		destroys: 0,
		createdWithConnect: null,
		countedConnecting: false,
		countedOpen: false,
		destroyReasons: [],
		wantsConnection: null,
	};
	rooms.set(room, record);
	return record;
}

function startSampling(): void {
	if (sampleTimer !== null || typeof setInterval === 'undefined') return;
	startedAt = now();
	sampleTimer = setInterval(() => {
		concurrencySamples.push([Math.round(now()), connectingCount, openCount]);
		if (concurrencySamples.length >= MAX_CONCURRENCY_SAMPLES && sampleTimer !== null) {
			clearInterval(sampleTimer);
			sampleTimer = null;
		}
	}, CONCURRENCY_SAMPLE_MS);
}

if (SYNC_DIAG_ENABLED) startSampling();

/**
 * One-shot boot milestones (registry synced, grid gave up waiting, and so on). First
 * occurrence only — re-recording these on every workspace switch would bury the one that
 * matters.
 */
export function recordSyncDiagMark(name: string, detail?: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	if (marks.length >= MAX_MARKS) return;
	if (marks.some((mark) => mark.name === name)) return;
	marks.push({ name, at: Math.round(now()), detail });
}

export function recordSyncDiagRequested(room: string, hadIdbContent?: boolean): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	if (record.requestedAt === null) record.requestedAt = Math.round(now());
	if (typeof hadIdbContent === 'boolean' && record.hadIdbContent === null) {
		record.hadIdbContent = hadIdbContent;
	}
}

/**
 * Whether this room is supposed to hold a socket at all.
 *
 * Without this the report became actively misleading the moment sockets stopped being opened
 * for every note: ~85 of 96 rooms would show under NEVER SYNCED, which is true and tells you
 * nothing, and would bury the two or three rooms that genuinely should have connected and
 * did not. "Never synced" is only interesting for a room that was trying.
 */
export function recordSyncDiagConnectionIntent(room: string, wanted: boolean): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	record.wantsConnection = wanted;
}

export function recordSyncDiagIdbReady(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record && record.idbReadyAt === null) record.idbReadyAt = Math.round(now());
}

export function recordSyncDiagWsCreated(room: string, connectRequested?: boolean): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	if (record.wsCreatedAt === null) record.wsCreatedAt = Math.round(now());
	record.providerCreations += 1;
	if (typeof connectRequested === 'boolean' && record.createdWithConnect === null) {
		record.createdWithConnect = connectRequested;
	}
}

export function recordSyncDiagRoomDestroyed(room: string, reason?: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	record.destroys += 1;
	// A destroyed provider emits no disconnect, so its gauge slots have to be handed back
	// here or both gauges drift for the rest of the session.
	releaseConnecting(record);
	releaseOpen(record);
	if (reason && !record.destroyReasons.includes(reason)) record.destroyReasons.push(reason);
}

/**
 * Lets the report read a provider's LIVE state at capture time.
 *
 * Needed because three rooms have now come back, on two devices and across four releases, with
 * `connects=0 disconnects=0 closes=0 errors=0` — a provider that was constructed and then never
 * attempted anything. Event counts cannot explain that by definition: there were no events.
 * Only the provider's current flags can say whether it thinks it should be connecting.
 */
type ProviderStateReader = (room: string) => string | null;
let providerStateReader: ProviderStateReader | null = null;

/**
 * App-level actions that affect every room at once.
 *
 * Added because a dev-server report showed all twenty open sockets drop to zero and climb back
 * to twenty around the seven-second mark, with every room reporting `connects=2 disconnects=1
 * closes=1` — and nothing in the report could say what did it. The room timings describe rooms;
 * they are silent about the app reaching in and cycling all of them. Guessing at that from
 * event counts is exactly the mistake that cost three wrong fixes on the stuck-room bug, so:
 * record the actions instead.
 *
 * Counted AND timestamped, because "once, during bootstrap" and "every few seconds, forever"
 * are completely different bugs that look identical in a first-occurrence-only mark.
 */
type LifecycleEvent = { at: number; label: string };

const MAX_LIFECYCLE_EVENTS = 60;
const lifecycleEvents: LifecycleEvent[] = [];

export function recordSyncDiagLifecycle(label: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	if (lifecycleEvents.length >= MAX_LIFECYCLE_EVENTS) return;
	lifecycleEvents.push({ at: Math.round(now()), label });
}

/**
 * Live socket counts, read at capture time.
 *
 * The whole point of connect-what-you-are-looking-at is a number: how many sockets are open
 * right now. Every other line in this report is a timing, and timings cannot answer it — a room
 * that synced an hour ago and has since been closed still shows as synced. Without this the
 * only way to check the headline claim was to count rows in devtools, which rules out the
 * device where it matters most.
 */
export type SyncDiagLiveCounts = {
	/** Rooms holding a WebSocket provider at all. */
	providers: number;
	/** Of those, how many are actually connected. */
	connected: number;
	/** Rooms the connection pool currently says should be connected. */
	pooled: number;
	/** Rooms with a document loaded, connected or not. */
	docs: number;
};

type LiveCountsReader = () => SyncDiagLiveCounts;

let liveCountsReader: LiveCountsReader | null = null;

export function setSyncDiagLiveCountsReader(reader: LiveCountsReader | null): void {
	liveCountsReader = reader;
}

export function setSyncDiagProviderStateReader(reader: ProviderStateReader | null): void {
	if (!SYNC_DIAG_ENABLED) return;
	providerStateReader = reader;
}

export function recordSyncDiagStatus(room: string, status: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	if (status === 'connecting') {
		if (record.connectingAt === null) record.connectingAt = Math.round(now());
		if (!record.countedConnecting) {
			record.countedConnecting = true;
			connectingCount += 1;
			if (connectingCount > maxConnecting) maxConnecting = connectingCount;
		}
		return;
	}
	if (status === 'connected') {
		releaseConnecting(record);
		record.connects += 1;
		if (record.connectedAt === null) record.connectedAt = Math.round(now());
		if (!record.countedOpen) {
			record.countedOpen = true;
			openCount += 1;
			if (openCount > maxOpen) maxOpen = openCount;
		}
		return;
	}
	if (status === 'disconnected') {
		releaseOpen(record);
		releaseConnecting(record);
		record.disconnects += 1;
	}
}

function releaseConnecting(record: RoomRecord): void {
	if (!record.countedConnecting) return;
	record.countedConnecting = false;
	connectingCount = Math.max(0, connectingCount - 1);
}

/**
 * Give back this room's slot in the OPEN gauge, if it holds one.
 *
 * The gauge used to increment on every `connected` and decrement only on a `disconnected`
 * status, gated on `connects > disconnects`. A provider that is DESTROYED rather than
 * disconnected emits no such status, so its slot was never returned and the gauge drifted
 * upward: a dev-server report showed `max simultaneous open 35` while no concurrency sample
 * ever exceeded 21. Exactly the same leak as the connecting gauge in 1.21.3, in the other
 * half of the pair, and the same fix — per-room occupancy that can only be held once and is
 * released from every path that ends a socket, including teardown.
 */
function releaseOpen(record: RoomRecord): void {
	if (!record.countedOpen) return;
	record.countedOpen = false;
	openCount = Math.max(0, openCount - 1);
}

export function recordSyncDiagSynced(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record && record.syncedAt === null) record.syncedAt = Math.round(now());
}

export function recordSyncDiagClose(room: string, code: number | null): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	record.closes += 1;
	record.lastCloseCode = code;
	// A close ends the attempt whether or not a `disconnected` status follows it — which is
	// exactly the case the old gauge missed.
	releaseConnecting(record);
	releaseOpen(record);
}

export function recordSyncDiagError(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	record.errors += 1;
	releaseConnecting(record);
}

/** The watchdog found this room wedged — not connected, not trying — and cycled it. */
export function recordSyncDiagWatchdogRescue(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record) record.watchdogRescues += 1;
}

export function getSyncDiagStatus(): { rooms: number; synced: number; pending: number; elapsedMs: number } {
	const all = Array.from(rooms.values());
	// Only rooms that are meant to be connected. The overlay's counter would otherwise sit
	// at something like 11/96 forever and read as a stall, when 85 of those rooms are
	// deliberately document-only and have nothing to sync.
	const wanted = all.filter((record) => record.wantsConnection !== false);
	const synced = wanted.filter((record) => record.syncedAt !== null).length;
	return {
		rooms: wanted.length,
		synced,
		pending: wanted.length - synced,
		elapsedMs: Math.round(now() - startedAt),
	};
}

function percentile(values: number[], fraction: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
	return sorted[index];
}

function phaseStats(label: string, values: number[]): string {
	if (values.length === 0) return `  ${label.padEnd(24)} (no samples)`;
	const total = values.reduce((sum, value) => sum + value, 0);
	return `  ${label.padEnd(24)} n=${String(values.length).padStart(4)}  p50=${String(percentile(values, 0.5)).padStart(6)}ms  p90=${String(percentile(values, 0.9)).padStart(6)}ms  max=${String(Math.max(...values)).padStart(6)}ms  sum=${String(Math.round(total)).padStart(7)}ms`;
}

function roomKind(room: string): string {
	if (room.includes('__notes_registry__')) return 'registry:notes';
	if (room.includes('__collections_registry__')) return 'registry:colls';
	if (room.includes('__labels_registry__')) return 'registry:labels';
	if (room.startsWith('markup:')) return 'markup';
	return 'note';
}

function delta(from: number | null, to: number | null): number | null {
	if (from === null || to === null) return null;
	return to - from;
}

function fmt(value: number | null): string {
	return value === null ? '—' : String(value);
}

export function formatSyncDiagReport(): string {
	const all = Array.from(rooms.values());
	const notes = all.filter((record) => roomKind(record.room) === 'note');
	const synced = all.filter((record) => record.syncedAt !== null);
	// A room nothing asked to connect has not failed to sync; it was never trying. Keeping
	// the two apart is what makes "never synced" a number worth reading.
	const never = all.filter((record) => record.syncedAt === null && record.wantsConnection !== false);
	const documentOnly = all.filter((record) => record.syncedAt === null && record.wantsConnection === false);

	const idbDurations = all.map((r) => delta(r.requestedAt, r.idbReadyAt)).filter((v): v is number => v !== null);
	const queueDurations = all.map((r) => delta(r.requestedAt, r.wsCreatedAt)).filter((v): v is number => v !== null);
	const connectDurations = all.map((r) => delta(r.wsCreatedAt, r.connectedAt)).filter((v): v is number => v !== null);
	const syncDurations = all.map((r) => delta(r.connectedAt, r.syncedAt)).filter((v): v is number => v !== null);
	const endToEnd = all.map((r) => delta(r.requestedAt, r.syncedAt)).filter((v): v is number => v !== null);

	const requestTimes = all.map((r) => r.requestedAt).filter((v): v is number => v !== null);
	const firstRequest = requestTimes.length > 0 ? Math.min(...requestTimes) : null;
	const lastSynced = synced.length > 0 ? Math.max(...synced.map((r) => r.syncedAt as number)) : null;
	const syncedNoteTimes = notes.map((r) => r.syncedAt).filter((v): v is number => v !== null);
	const firstNoteSynced = syncedNoteTimes.length > 0 ? Math.min(...syncedNoteTimes) : null;
	const registryCount = all.filter((record) => roomKind(record.room).startsWith('registry')).length;

	const lines: string[] = [];
	lines.push('=== FREEMAN NOTES — SYNC TIMING REPORT ===');
	const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?';
	const build = typeof __BUILD_TAG__ === 'string' ? __BUILD_TAG__ : '?';
	const isDev = typeof __IS_DEV_BUILD__ !== 'undefined' && __IS_DEV_BUILD__ ? ' (dev)' : '';
	lines.push(`app ${version} build ${build}${isDev}`);
	if (typeof navigator !== 'undefined') {
		lines.push(`ua ${navigator.userAgent}`);
		const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
		const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches;
		lines.push(`online=${navigator.onLine} pointer=${coarse ? 'coarse' : 'fine'} display-mode=${standalone ? 'standalone' : 'browser'}`);
	}
	if (typeof location !== 'undefined') lines.push(`origin ${location.origin}`);
	lines.push(`captured ${Math.round(now())}ms after page load`);
	lines.push('');

	lines.push('--- HEADLINE ---');
	lines.push(`rooms opened            ${all.length}  (notes ${notes.length}, registries ${registryCount})`);
	lines.push(`reached synced          ${synced.length}`);
	lines.push(`never synced            ${never.length}   <-- rooms that WERE meant to connect`);
	lines.push(`document-only          ${documentOnly.length}   <-- loaded from IndexedDB, no socket by design`);
	const live = liveCountsReader ? liveCountsReader() : null;
	if (live) {
		lines.push(`sockets OPEN NOW       ${live.connected} connected of ${live.providers} providers   <-- the number this whole change is about`);
		lines.push(`pool wants             ${live.pooled}   (documents loaded: ${live.docs})`);
	}
	lines.push(`first room requested    ${fmt(firstRequest)}ms`);
	lines.push(`first NOTE synced       ${fmt(firstNoteSynced)}ms`);
	lines.push(`last room synced        ${fmt(lastSynced)}ms   <-- when the app actually became current`);
	lines.push('');

	lines.push('--- WHERE THE TIME GOES (the question this report exists to answer) ---');
	lines.push(phaseStats('requested -> idbReady', idbDurations));
	lines.push(phaseStats('requested -> wsCreated', queueDurations));
	lines.push(phaseStats('wsCreated -> connected', connectDurations));
	lines.push(phaseStats('connected -> synced', syncDurations));
	lines.push(phaseStats('requested -> synced', endToEnd));
	lines.push('');
	lines.push('  wsCreated->connected dominating = handshake cost (socket ceiling / Cloudflare / nginx)');
	lines.push('  connected->synced dominating    = server cost (auth query + Postgres read)');
	lines.push('  requested->wsCreated dominating = our own client-side queuing');
	lines.push('');
	lines.push('  CAVEAT: a provider is constructed before sync is switched on, so');
	lines.push('  wsCreated->connected INCLUDES the wait for websocket-ENABLED. Check its');
	lines.push('  timestamp in LIFECYCLE before reading this as handshake cost - measured 3.9s');
	lines.push('  of it on localhost, where a handshake costs nothing at all.');
	lines.push('');

	lines.push('--- CONCURRENCY ---');
	lines.push(`max simultaneous connecting  ${maxConnecting}`);
	lines.push(`max simultaneous open        ${maxOpen}`);
	if (concurrencySamples.length > 0) {
		lines.push('  t(ms)  connecting  open');
		const step = Math.max(1, Math.floor(concurrencySamples.length / 40));
		for (let index = 0; index < concurrencySamples.length; index += step) {
			const [t, connecting, open] = concurrencySamples[index];
			lines.push(`  ${String(t).padStart(6)}  ${String(connecting).padStart(10)}  ${String(open).padStart(4)}`);
		}
	}
	lines.push('');

	lines.push('--- MARKS ---');
	if (marks.length === 0) lines.push('  (none)');
	for (const mark of [...marks].sort((left, right) => left.at - right.at)) {
		lines.push(`  ${String(mark.at).padStart(6)}ms  ${mark.name}${mark.detail ? `  ${mark.detail}` : ''}`);
	}
	lines.push('');

	lines.push('--- PENDING CHANGES (what the change-chip system decided, in order) ---');
	if (pendingTrace.length === 0) {
		lines.push('  (nothing recorded - no change from another person was seen at all)');
	} else {
		for (const entry of pendingTrace) {
			lines.push(`  ${String(entry.at).padStart(6)}ms  ${entry.kind.padEnd(22)}${entry.detail}`);
		}
		if (pendingTrace.length >= MAX_PENDING_TRACE) lines.push('  (truncated)');
	}
	lines.push('');

	lines.push('--- SLOWEST 20 ROOMS (by requested -> synced) ---');
	lines.push('   total  queue    idb  connect   sync  kind            idb?  room');
	const ranked = [...all].sort(
		(left, right) =>
			(delta(right.requestedAt, right.syncedAt) ?? Number.MAX_SAFE_INTEGER)
			- (delta(left.requestedAt, left.syncedAt) ?? Number.MAX_SAFE_INTEGER)
	);
	for (const record of ranked.slice(0, 20)) {
		lines.push([
			`  ${fmt(delta(record.requestedAt, record.syncedAt)).padStart(6)}`,
			fmt(delta(record.requestedAt, record.wsCreatedAt)).padStart(6),
			fmt(delta(record.requestedAt, record.idbReadyAt)).padStart(6),
			fmt(delta(record.wsCreatedAt, record.connectedAt)).padStart(8),
			fmt(delta(record.connectedAt, record.syncedAt)).padStart(6),
			` ${roomKind(record.room).padEnd(15)}`,
			(record.hadIdbContent === null ? '?' : record.hadIdbContent ? 'yes' : 'NO').padEnd(5),
			record.room,
		].join(' '));
	}
	lines.push('');

	if (never.length > 0) {
		lines.push('--- NEVER SYNCED (and supposed to be connected) ---');
		for (const record of never.slice(0, 40)) {
			lines.push(`  ${roomKind(record.room).padEnd(15)} connects=${record.connects} disconnects=${record.disconnects} closes=${record.closes} lastCode=${fmt(record.lastCloseCode)} errors=${record.errors}  ${record.room}`);
		}
		lines.push('');

		lines.push('--- STUCK ROOM FORENSICS ---');
		lines.push('  A provider with no events at all cannot be explained by event counts. These are');
		lines.push('  its construction history and its live flags, read at capture time.');
		for (const record of never.slice(0, 10)) {
			lines.push(`  ${record.room}`);
			lines.push(`    providerCreations=${record.providerCreations} destroys=${record.destroys} createdWithConnect=${record.createdWithConnect === null ? '?' : record.createdWithConnect}`);
			if (record.destroyReasons.length > 0) {
				lines.push(`    destroyedBy: ${record.destroyReasons.join(', ')}`);
			}
			lines.push(`    requestedAt=${fmt(record.requestedAt)}ms idbReadyAt=${fmt(record.idbReadyAt)}ms wsCreatedAt=${fmt(record.wsCreatedAt)}ms connectingAt=${fmt(record.connectingAt)}ms`);
			const live = providerStateReader ? providerStateReader(record.room) : null;
			lines.push(`    live: ${live ?? '(no reader registered)'}`);
		}
		lines.push('');
	}

	if (lifecycleEvents.length > 0) {
		lines.push('--- LIFECYCLE (app-level actions that hit every room at once) ---');
		for (const event of lifecycleEvents) {
			lines.push(`  ${String(event.at).padStart(7)}ms  ${event.label}`);
		}
		if (lifecycleEvents.length >= MAX_LIFECYCLE_EVENTS) {
			lines.push(`  (capped at ${MAX_LIFECYCLE_EVENTS} — there were more)`);
		}
		lines.push('');
	}

	const rescued = all.filter((record) => record.watchdogRescues > 0);
	if (rescued.length > 0) {
		lines.push('--- WATCHDOG RESCUES (a room was wedged: not connected, not trying) ---');
		for (const record of rescued.slice(0, 40)) {
			lines.push(`  rescues=${record.watchdogRescues} connects=${record.connects} closes=${record.closes} errors=${record.errors}  ${record.room}`);
		}
		lines.push('');
	}

	const churn = all.filter((record) => record.connects > 1 || record.closes > 0 || record.errors > 0);
	if (churn.length > 0) {
		lines.push('--- RECONNECTS / CLOSES / ERRORS ---');
		for (const record of churn.slice(0, 40)) {
			lines.push(`  connects=${record.connects} disconnects=${record.disconnects} closes=${record.closes} lastCode=${fmt(record.lastCloseCode)} errors=${record.errors}  ${record.room}`);
		}
		lines.push('');
	}

	lines.push('=== END ===');
	return lines.join('\n');
}
