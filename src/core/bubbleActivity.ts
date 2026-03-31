export type BubbleActivityEntry = {
	recentEditTimestamps: number[];
	activeDayKeys: number[];
	lastSeenUpdatedAt: number;
};

export type BubbleActivityStore = Record<string, BubbleActivityEntry>;

const BUBBLE_ACTIVITY_STORAGE_KEY = 'fn_bubble_activity_v1';
const TEN_MINUTES_MS = 10 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function createEmptyEntry(): BubbleActivityEntry {
	return {
		recentEditTimestamps: [],
		activeDayKeys: [],
		lastSeenUpdatedAt: 0,
	};
}

function toDayKey(timestamp: number): number {
	const date = new Date(timestamp);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
}

function normalizeTimestampArray(values: unknown): number[] {
	if (!Array.isArray(values)) return [];
	return values
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value) && value > 0)
		.sort((left, right) => left - right);
}

export function loadBubbleActivityStore(): BubbleActivityStore {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(BUBBLE_ACTIVITY_STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const entries = Object.entries(parsed || {});
		const store: BubbleActivityStore = {};
		for (const [key, value] of entries) {
			if (!value || typeof value !== 'object') continue;
			const row = value as Record<string, unknown>;
			store[key] = {
				recentEditTimestamps: normalizeTimestampArray(row.recentEditTimestamps),
				activeDayKeys: normalizeTimestampArray(row.activeDayKeys),
				lastSeenUpdatedAt: Number.isFinite(Number(row.lastSeenUpdatedAt)) ? Number(row.lastSeenUpdatedAt) : 0,
			};
		}
		return store;
	} catch {
		return {};
	}
}

export function saveBubbleActivityStore(store: BubbleActivityStore): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(BUBBLE_ACTIVITY_STORAGE_KEY, JSON.stringify(store));
	} catch {
		// Ignore persistence errors.
	}
}

function pruneEntry(entry: BubbleActivityEntry, nowMs: number): BubbleActivityEntry {
	const minRecentTimestamp = nowMs - TEN_MINUTES_MS;
	const minDayKey = toDayKey(nowMs - SEVEN_DAYS_MS + ONE_DAY_MS);
	return {
		recentEditTimestamps: entry.recentEditTimestamps.filter((timestamp) => timestamp >= minRecentTimestamp),
		activeDayKeys: entry.activeDayKeys.filter((dayKey) => dayKey >= minDayKey),
		lastSeenUpdatedAt: entry.lastSeenUpdatedAt,
	};
}

export function updateBubbleActivityStore(
	store: BubbleActivityStore,
	entryKey: string,
	updatedAt: number,
	nowMs = Date.now()
): { store: BubbleActivityStore; changed: boolean } {
	const current = pruneEntry(store[entryKey] ?? createEmptyEntry(), nowMs);
	if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt <= current.lastSeenUpdatedAt) {
		const hadDifferentPrunedState = JSON.stringify(current) !== JSON.stringify(store[entryKey] ?? createEmptyEntry());
		if (!hadDifferentPrunedState) return { store, changed: false };
		return {
			store: {
				...store,
				[entryKey]: current,
			},
			changed: true,
		};
	}

	const nextRecentEditTimestamps = [...current.recentEditTimestamps, updatedAt]
		.filter((timestamp, index, array) => index === 0 || timestamp !== array[index - 1]);
	const dayKey = toDayKey(updatedAt);
	const nextActiveDayKeys = current.activeDayKeys.includes(dayKey)
		? current.activeDayKeys
		: [...current.activeDayKeys, dayKey].sort((left, right) => left - right);
	const nextEntry: BubbleActivityEntry = pruneEntry({
		recentEditTimestamps: nextRecentEditTimestamps,
		activeDayKeys: nextActiveDayKeys,
		lastSeenUpdatedAt: updatedAt,
	}, nowMs);

	return {
		store: {
			...store,
			[entryKey]: nextEntry,
		},
		changed: true,
	};
}

export function getBubbleActivityMetrics(store: BubbleActivityStore, entryKey: string, nowMs = Date.now()): { editsLast10Min: number; activeDaysLast7: number } {
	const entry = pruneEntry(store[entryKey] ?? createEmptyEntry(), nowMs);
	return {
		editsLast10Min: entry.recentEditTimestamps.length,
		activeDaysLast7: entry.activeDayKeys.length,
	};
}