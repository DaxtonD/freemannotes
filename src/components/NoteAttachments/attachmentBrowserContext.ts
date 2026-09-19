import React from 'react';

/**
 * True for anything rendered inside AttachmentBrowserModalFrame (the modal a note card's
 * attachment chip opens).
 *
 * The attachment panels — images, links, documents, drawings — each print their own
 * section label ("LINKS", "DOCUMENTS", …) because in the editor's media dock that's the
 * only thing naming the section. The browser modal already puts that exact word in its
 * subtitle, so inside it the panel's own label is the same word twice in a row. Every
 * panel used to be told individually not to do that, and every panel added since forgot,
 * which is how three of the four shipped showing it. Reading the context means a panel
 * gets it right by existing rather than by the modal remembering to say so.
 */
export const AttachmentBrowserContext = React.createContext(false);

export function useIsInsideAttachmentBrowser(): boolean {
	return React.useContext(AttachmentBrowserContext);
}
