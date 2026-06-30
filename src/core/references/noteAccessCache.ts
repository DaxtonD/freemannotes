import React from 'react';

// Module-level cache of note IDs the current user has been denied access to.
// Persists for the browser session — access grants are rare enough that
// page reload is an acceptable way to clear a stale denial.

let denied = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function getSnapshot(): Set<string> {
	return denied;
}

export function markNoteDenied(noteId: string): void {
	if (denied.has(noteId)) return;
	denied = new Set(denied);
	denied.add(noteId);
	listeners.forEach((l) => l());
}

export function isNoteDenied(noteId: string): boolean {
	return denied.has(noteId);
}

export function useIsNoteDenied(noteId: string): boolean {
	const set = React.useSyncExternalStore(subscribe, getSnapshot);
	return set.has(noteId);
}

export function useDeniedNoteIds(): Set<string> {
	return React.useSyncExternalStore(subscribe, getSnapshot);
}
