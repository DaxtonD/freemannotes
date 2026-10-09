// Turns a document's OCR columns into something to show a person.
//
// A scanned PDF has no text layer, so the server renders every page that's empty and runs
// PaddleOCR over it (server/documentOcrQueue.js). On a long document that is minutes of work,
// and "nothing is happening" is indistinguishable from "it's broken" — so the panel says which
// page it's on and roughly how much longer.
//
// Shared by the documents panel (the badge on the row) and the text viewer (the notice where
// the text will appear), so both describe the same state in the same words.

import type { NoteDocumentRecord } from '../../core/noteDocumentApi';

type Translate = (key: string) => string;

export type DocumentOcrProgress =
	/** Nothing to say: the text is there, or this file never needed recognising. */
	| { state: 'idle' }
	/** Server has it, nothing has started on it yet. */
	| { state: 'queued' }
	/** Being read right now. `secondsLeft` is null until a page has finished and set the pace. */
	| { state: 'reading'; pagesDone: number; pagesTotal: number; secondsLeft: number | null }
	/** Finished, but some pages couldn't be read. There IS text — just not all of it. */
	| { state: 'partial' }
	/** Couldn't be read at all. */
	| { state: 'failed' };

/**
 * A document still on the device hasn't reached the server, so nothing can be reading it yet —
 * the upload badge covers that case and would otherwise fight with this one.
 */
export function readDocumentOcrProgress(document: NoteDocumentRecord): DocumentOcrProgress {
	if (document.isLocal) return { state: 'idle' };

	if (document.ocrStatus === 'FAILED') return { state: 'failed' };

	if (document.ocrStatus === 'PENDING') {
		const startedAt = document.ocrStartedAt ? Date.parse(document.ocrStartedAt) : NaN;
		const pagesTotal = Number(document.ocrPagesTotal || 0);
		// Both queued and in-progress sit at PENDING; a start time is what separates them.
		if (!Number.isFinite(startedAt) || pagesTotal <= 0) return { state: 'queued' };

		const pagesDone = Math.max(0, Math.min(pagesTotal, Number(document.ocrPagesDone || 0)));
		const elapsedMs = Date.now() - startedAt;
		// Pace is measured from this document's own pages rather than guessed, because it depends
		// on the hardware, how many pages run at once, and how much is on them. Until one page is
		// done there's nothing to measure, so no estimate is offered. A clock skewed into the
		// future would otherwise produce a negative "remaining".
		const secondsLeft = pagesDone > 0 && elapsedMs > 0
			? Math.max(0, Math.round(((elapsedMs / pagesDone) * (pagesTotal - pagesDone)) / 1000))
			: null;
		return { state: 'reading', pagesDone, pagesTotal, secondsLeft };
	}

	// COMPLETE with an error recorded means some pages were readable and some weren't.
	if (document.ocrError) return { state: 'partial' };
	return { state: 'idle' };
}

/** Rounded hard on purpose: a to-the-second countdown on an estimate this rough is a lie. */
export function formatOcrTimeLeft(secondsLeft: number, t: Translate): string {
	if (secondsLeft < 75) return t('documents.ocrTimeUnderMinute');
	const minutes = Math.round(secondsLeft / 60);
	if (minutes < 60) return t('documents.ocrTimeMinutes').replace('{n}', String(minutes));
	const hours = Math.round(secondsLeft / 360) / 10;
	return t('documents.ocrTimeHours').replace('{n}', String(hours));
}

/** The one-line badge for a document row, or null when there's nothing worth saying. */
export function formatDocumentOcrStatus(progress: DocumentOcrProgress, t: Translate): string | null {
	switch (progress.state) {
		case 'queued':
			return t('documents.ocrQueued');
		case 'reading': {
			const counted = t('documents.ocrReadingPages')
				.replace('{done}', String(progress.pagesDone))
				.replace('{total}', String(progress.pagesTotal));
			if (progress.secondsLeft === null) return counted;
			return `${counted} · ${formatOcrTimeLeft(progress.secondsLeft, t)}`;
		}
		case 'partial':
			return t('documents.ocrPartial');
		case 'failed':
			return t('documents.ocrFailed');
		default:
			return null;
	}
}

/** Whether anything in this list is mid-read, so the view knows to keep its clock ticking. */
export function anyDocumentIsReading(documents: readonly NoteDocumentRecord[]): boolean {
	return documents.some((document) => readDocumentOcrProgress(document).state === 'reading');
}
