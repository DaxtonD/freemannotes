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
};

type Mark = { name: string; at: number; detail?: string };

const MAX_ROOMS = 5000;
const MAX_MARKS = 500;
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

export function recordSyncDiagIdbReady(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record && record.idbReadyAt === null) record.idbReadyAt = Math.round(now());
}

export function recordSyncDiagWsCreated(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record && record.wsCreatedAt === null) record.wsCreatedAt = Math.round(now());
}

export function recordSyncDiagStatus(room: string, status: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (!record) return;
	if (status === 'connecting') {
		if (record.connectingAt === null) record.connectingAt = Math.round(now());
		connectingCount += 1;
		if (connectingCount > maxConnecting) maxConnecting = connectingCount;
		return;
	}
	if (status === 'connected') {
		if (connectingCount > 0) connectingCount -= 1;
		record.connects += 1;
		if (record.connectedAt === null) record.connectedAt = Math.round(now());
		openCount += 1;
		if (openCount > maxOpen) maxOpen = openCount;
		return;
	}
	if (status === 'disconnected') {
		// A disconnect can end either an open socket or one that never finished connecting;
		// decrement whichever this room was actually occupying.
		if (record.connects > record.disconnects) openCount = Math.max(0, openCount - 1);
		else if (connectingCount > 0) connectingCount -= 1;
		record.disconnects += 1;
	}
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
}

export function recordSyncDiagError(room: string): void {
	if (!SYNC_DIAG_ENABLED) return;
	const record = ensureRoom(room);
	if (record) record.errors += 1;
}

export function getSyncDiagStatus(): { rooms: number; synced: number; pending: number; elapsedMs: number } {
	const all = Array.from(rooms.values());
	const synced = all.filter((record) => record.syncedAt !== null).length;
	return {
		rooms: all.length,
		synced,
		pending: all.length - synced,
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
	const never = all.filter((record) => record.syncedAt === null);

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
	lines.push(`never synced            ${never.length}`);
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
		lines.push('--- NEVER SYNCED ---');
		for (const record of never.slice(0, 40)) {
			lines.push(`  ${roomKind(record.room).padEnd(15)} connects=${record.connects} disconnects=${record.disconnects} closes=${record.closes} lastCode=${fmt(record.lastCloseCode)} errors=${record.errors}  ${record.room}`);
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
