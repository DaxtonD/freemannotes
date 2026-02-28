import React from 'react';
import { DocumentManager } from './DocumentManager';

// Shared app-wide DocumentManager dependency.
const DocumentManagerContext = React.createContext<DocumentManager | null>(null);

export function DocumentManagerProvider(props: {
	manager: DocumentManager;
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<DocumentManagerContext.Provider value={props.manager}>
			{props.children}
		</DocumentManagerContext.Provider>
	);
}

export function useDocumentManager(): DocumentManager {
	// Consumer hook enforces provider usage at runtime for clearer integration errors.
	const manager = React.useContext(DocumentManagerContext);
	if (!manager) {
		throw new Error('useDocumentManager must be used within <DocumentManagerProvider>.');
	}
	return manager;
}
