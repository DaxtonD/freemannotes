import { useSyncExternalStore } from 'react';

const KEY = 'freemannotes:bubbleMenuEnabled';

// Shared local preference store for the optional rich-text bubble menu.
// This stays intentionally tiny: localStorage for persistence plus a small
// subscriber set so mounted editors react immediately to preference changes.

function getSnapshot(): boolean {
	try {
		return localStorage.getItem(KEY) === 'true';
	} catch {
		return false;
	}
}

function getServerSnapshot(): boolean {
	return false;
}

const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
	listeners.add(onStoreChange);
	return () => listeners.delete(onStoreChange);
}

export function useBubbleMenuEnabled(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setBubbleMenuEnabled(enabled: boolean): void {
	try {
		if (enabled) {
			localStorage.setItem(KEY, 'true');
		} else {
			localStorage.removeItem(KEY);
		}
	} catch {
		// localStorage unavailable – ignore.
	}
	// Notify already-mounted editors immediately; they should not require a reload.
	for (const fn of listeners) fn();
}
