import * as React from 'react';
import { useDocumentManager } from './DocumentManagerContext';

export function useConnectionStatus() {
	const manager = useDocumentManager();

	return React.useSyncExternalStore(
		(listener) => manager.subscribeConnectionStatus(listener),
		() => manager.getConnectionSnapshot(),
		() => manager.getConnectionSnapshot()
	);
}
