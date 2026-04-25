import React from 'react';
import type { StartupHydrationSnapshot } from './startupHydration';

// Safe fallback for tests or legacy mounts that render before boot hydration runs.
const EMPTY_STARTUP_HYDRATION: StartupHydrationSnapshot = {
	deviceId: 'legacy',
	userId: null,
	workspaceId: null,
	hasWarmCache: false,
	workspaceSnapshot: null,
	workspaceList: [],
	deviceAppearance: null,
	reminderStates: [],
	noteOrderIds: [],
	collections: [],
	labels: [],
	hydratedAt: 0,
};

const StartupHydrationContext = React.createContext<StartupHydrationSnapshot>(EMPTY_STARTUP_HYDRATION);

// Exposes the boot-time cache snapshot to the full React tree without forcing
// each startup-sensitive subsystem to reread localStorage or IndexedDB.
export function StartupHydrationProvider(props: { value: StartupHydrationSnapshot; children: React.ReactNode }): React.JSX.Element {
	return (
		<StartupHydrationContext.Provider value={props.value}>
			{props.children}
		</StartupHydrationContext.Provider>
	);
}

// Consumers can assume this always returns a valid object, even during tests.
export function useStartupHydration(): StartupHydrationSnapshot {
	return React.useContext(StartupHydrationContext);
}