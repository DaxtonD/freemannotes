import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { normalizeChecklistCountValue } from './checklistCounts';
import { readNoteFromDoc } from './noteModel';
import { extractNoteLinksFromDoc, setNotePreviewLinksOnDoc, type ExtractedNoteLink } from './noteLinks';
import type { NoteLinkRecord } from './noteLinkApi';
import {
	CHECKLIST_ITEM_RICH_FIELD,
	getChecklistItemRichPreviewJson,
	getTextNoteRichPreviewJson,
	replaceRichFragmentFromJson,
	TEXT_NOTE_RICH_FIELD,
} from './richText';
import type { ViewMode } from './viewMode';

export type WorkspaceRenderSnapshotChecklistItem = {
	id: string;
	text: string;
	completed: boolean;
	completedAt: number | null;
	parentId: string | null;
	countValue: number | null;
	richContent: JSONContent | null;
};

export type WorkspaceRenderSnapshotAttachmentCounts = {
	images: number;
	links: number;
	drawings: number;
};

export type WorkspaceRenderSnapshotPreviewCard = {
	normalizedUrl: string;
	originalUrl: string;
	hostname: string;
	rootDomain: string;
	siteName: string | null;
	title: string | null;
	description: string | null;
	mainContent: string | null;
	imageUrl: string | null;
	imageUrls: string[];
	sortOrder: number;
	status: 'PENDING' | 'READY' | 'FAILED';
};

export type WorkspaceRenderSnapshotNote = {
	id: string;
	type: 'text' | 'checklist' | 'drawing';
	title: string;
	content: string;
	richContent: JSONContent | null;
	checklistItems: WorkspaceRenderSnapshotChecklistItem[];
	createdAt: number;
	updatedAt: number;
	collectionId: string | null;
	labelIds: string[];
	reminderAt: string | null;
	isPinned: boolean;
	lastAccessedAt: string;
	drawingIds: string[];
	trashed: boolean;
	archived: boolean;
	colorToken: string | null;
	bannerFile: string | null;
	hasSharedBannerPreference: boolean;
	collaboratorCount: number;
	attachmentCounts: WorkspaceRenderSnapshotAttachmentCounts;
	previewLinks: ExtractedNoteLink[];
	previewCards: WorkspaceRenderSnapshotPreviewCard[];
};

function sanitizePreviewCards(value: unknown): WorkspaceRenderSnapshotPreviewCard[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((card, index) => ({
			normalizedUrl: asString((card as { normalizedUrl?: unknown }).normalizedUrl),
			originalUrl: asString((card as { originalUrl?: unknown }).originalUrl),
			hostname: asString((card as { hostname?: unknown }).hostname),
			rootDomain: asString((card as { rootDomain?: unknown }).rootDomain),
			siteName: asStringOrNull((card as { siteName?: unknown }).siteName),
			title: asStringOrNull((card as { title?: unknown }).title),
			description: asStringOrNull((card as { description?: unknown }).description),
			mainContent: asStringOrNull((card as { mainContent?: unknown }).mainContent),
			imageUrl: asStringOrNull((card as { imageUrl?: unknown }).imageUrl),
			imageUrls: Array.isArray((card as { imageUrls?: unknown }).imageUrls)
				? ((card as { imageUrls?: unknown[] }).imageUrls ?? []).map((imageUrl) => asString(imageUrl)).filter(Boolean)
				: [],
			sortOrder: Math.max(0, Math.floor(asNumber((card as { sortOrder?: unknown }).sortOrder, index))),
			status: (card as { status?: unknown }).status === 'FAILED'
				? 'FAILED'
				: (card as { status?: unknown }).status === 'READY'
					? 'READY'
					: 'PENDING',
		}))
		.filter((card) => card.normalizedUrl.length > 0 && card.originalUrl.length > 0);
}

export function toWorkspaceRenderSnapshotPreviewCards(links: readonly NoteLinkRecord[]): WorkspaceRenderSnapshotPreviewCard[] {
	return links.map((link, index) => ({
		normalizedUrl: link.normalizedUrl,
		originalUrl: link.originalUrl,
		hostname: link.hostname,
		rootDomain: link.rootDomain,
		siteName: link.siteName ?? null,
		title: link.title ?? null,
		description: link.description ?? null,
		mainContent: link.mainContent ?? null,
		imageUrl: link.imageUrl ?? null,
		imageUrls: Array.isArray(link.imageUrls) ? link.imageUrls.filter(Boolean) : [],
		sortOrder: Math.max(0, Math.floor(Number(link.sortOrder ?? index) || index)),
		status: link.status === 'FAILED' ? 'FAILED' : link.status === 'READY' ? 'READY' : 'PENDING',
	}));
}

export type WorkspaceRenderSnapshot = {
	v: 1;
	workspaceId: string;
	orderedIds: string[];
	notes: WorkspaceRenderSnapshotNote[];
	scrollByView: Partial<Record<ViewMode, number>>;
	savedAt: string;
};

const VERSION = 1;
const KEY_PREFIX = 'freemannotes.workspaceRenderSnapshot.v1.';

function getSnapshotKey(workspaceId: string): string {
	return `${KEY_PREFIX}${workspaceId}`;
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
	const next = Number(value);
	return Number.isFinite(next) ? next : fallback;
}

function sanitizeJsonContent(value: unknown): JSONContent | null {
	if (!value || typeof value !== 'object') return null;
	return value as JSONContent;
}

function sanitizeChecklistItems(value: unknown): WorkspaceRenderSnapshotChecklistItem[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => ({
			id: asString((item as { id?: unknown }).id),
			text: asString((item as { text?: unknown }).text),
			completed: Boolean((item as { completed?: unknown }).completed),
			completedAt: Number.isFinite(asNumber((item as { completedAt?: unknown }).completedAt, Number.NaN))
				? asNumber((item as { completedAt?: unknown }).completedAt)
				: null,
			parentId: asStringOrNull((item as { parentId?: unknown }).parentId),
			countValue: normalizeChecklistCountValue((item as { countValue?: unknown }).countValue),
			richContent: sanitizeJsonContent((item as { richContent?: unknown }).richContent),
		}))
		.filter((item) => item.id.length > 0);
}

function sanitizeNotes(value: unknown): WorkspaceRenderSnapshotNote[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((note) => ({
			id: asString((note as { id?: unknown }).id),
			type: (note as { type?: unknown }).type === 'checklist'
				? 'checklist'
				: (note as { type?: unknown }).type === 'drawing'
					? 'drawing'
					: 'text',
			title: asString((note as { title?: unknown }).title),
			content: asString((note as { content?: unknown }).content),
			richContent: sanitizeJsonContent((note as { richContent?: unknown }).richContent),
			checklistItems: sanitizeChecklistItems((note as { checklistItems?: unknown }).checklistItems),
			createdAt: asNumber((note as { createdAt?: unknown }).createdAt),
			updatedAt: asNumber((note as { updatedAt?: unknown }).updatedAt),
			collectionId: asStringOrNull((note as { collectionId?: unknown }).collectionId),
			labelIds: Array.isArray((note as { labelIds?: unknown }).labelIds)
				? ((note as { labelIds?: unknown[] }).labelIds ?? []).map((labelId) => asString(labelId)).filter(Boolean)
				: [],
			reminderAt: asStringOrNull((note as { reminderAt?: unknown }).reminderAt),
			isPinned: Boolean((note as { isPinned?: unknown }).isPinned),
			lastAccessedAt: asString((note as { lastAccessedAt?: unknown }).lastAccessedAt, new Date(0).toISOString()),
			drawingIds: Array.isArray((note as { drawingIds?: unknown }).drawingIds)
				? ((note as { drawingIds?: unknown[] }).drawingIds ?? []).map((drawingId) => asString(drawingId)).filter(Boolean)
				: [],
			trashed: Boolean((note as { trashed?: unknown }).trashed),
			archived: Boolean((note as { archived?: unknown }).archived),
			colorToken: asStringOrNull((note as { colorToken?: unknown }).colorToken),
			bannerFile: asStringOrNull((note as { bannerFile?: unknown }).bannerFile),
			hasSharedBannerPreference: Boolean((note as { hasSharedBannerPreference?: unknown }).hasSharedBannerPreference),
			collaboratorCount: Math.max(0, Math.floor(asNumber((note as { collaboratorCount?: unknown }).collaboratorCount))),
			attachmentCounts: {
				images: Math.max(0, Math.floor(asNumber((note as { attachmentCounts?: { images?: unknown } }).attachmentCounts?.images))),
				links: Math.max(0, Math.floor(asNumber((note as { attachmentCounts?: { links?: unknown } }).attachmentCounts?.links))),
				drawings: Math.max(0, Math.floor(asNumber((note as { attachmentCounts?: { drawings?: unknown } }).attachmentCounts?.drawings))),
			},
			previewLinks: Array.isArray((note as { previewLinks?: unknown }).previewLinks)
				? ((note as { previewLinks?: unknown[] }).previewLinks ?? [])
					.map((link, index) => ({
						url: asString((link as { url?: unknown }).url),
						normalizedUrl: asString((link as { normalizedUrl?: unknown }).normalizedUrl),
						hostname: asString((link as { hostname?: unknown }).hostname),
						rootDomain: asString((link as { rootDomain?: unknown }).rootDomain),
						sortOrder: Math.max(0, Math.floor(asNumber((link as { sortOrder?: unknown }).sortOrder, index))),
					}))
					.filter((link) => link.url.length > 0 && link.normalizedUrl.length > 0)
				: [],
			previewCards: sanitizePreviewCards((note as { previewCards?: unknown }).previewCards),
		}))
		.filter((note) => note.id.length > 0);
}

function sanitizeScrollByView(value: unknown): Partial<Record<ViewMode, number>> {
	if (!value || typeof value !== 'object') return {};
	const next: Partial<Record<ViewMode, number>> = {};
	for (const viewMode of ['card', 'list', 'strip', 'bubble'] as const satisfies readonly ViewMode[]) {
		const scrollY = asNumber((value as Record<string, unknown>)[viewMode], Number.NaN);
		if (Number.isFinite(scrollY) && scrollY >= 0) {
			next[viewMode] = Math.round(scrollY);
		}
	}
	return next;
}

export function hasWorkspaceRenderSnapshot(workspaceId: string | null | undefined): boolean {
	return readWorkspaceRenderSnapshot(workspaceId) !== null;
}

export function readWorkspaceRenderSnapshot(workspaceId: string | null | undefined): WorkspaceRenderSnapshot | null {
	if (typeof window === 'undefined' || !workspaceId) return null;
	try {
		const raw = window.localStorage.getItem(getSnapshotKey(workspaceId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<WorkspaceRenderSnapshot> | null;
		if (!parsed || parsed.v !== VERSION) return null;
		return {
			v: 1,
			workspaceId: asString(parsed.workspaceId),
			orderedIds: Array.isArray(parsed.orderedIds)
				? parsed.orderedIds.map((noteId) => asString(noteId)).filter(Boolean)
				: [],
			notes: sanitizeNotes(parsed.notes),
			scrollByView: sanitizeScrollByView(parsed.scrollByView),
			savedAt: asString(parsed.savedAt, new Date(0).toISOString()),
		};
	} catch {
		return null;
	}
}

export function writeWorkspaceRenderSnapshot(args: {
	workspaceId: string;
	orderedIds: readonly string[];
	notes: readonly WorkspaceRenderSnapshotNote[];
	scrollByView?: Partial<Record<ViewMode, number>>;
}): void {
	if (typeof window === 'undefined' || !args.workspaceId) return;
	try {
		const previous = readWorkspaceRenderSnapshot(args.workspaceId);
		const payload: WorkspaceRenderSnapshot = {
			v: 1,
			workspaceId: args.workspaceId,
			orderedIds: args.orderedIds.map((noteId) => asString(noteId)).filter(Boolean),
			notes: sanitizeNotes(args.notes),
			scrollByView: {
				...(previous?.scrollByView ?? {}),
				...(args.scrollByView ?? {}),
			},
			savedAt: new Date().toISOString(),
		};
		window.localStorage.setItem(getSnapshotKey(args.workspaceId), JSON.stringify(payload));
	} catch {
		// Best effort only.
	}
}

export function writeWorkspaceRenderSnapshotScroll(workspaceId: string, viewMode: ViewMode, scrollY: number): void {
	if (typeof window === 'undefined' || !workspaceId) return;
	try {
		const previous = readWorkspaceRenderSnapshot(workspaceId);
		if (!previous) return;
		writeWorkspaceRenderSnapshot({
			workspaceId,
			orderedIds: previous.orderedIds,
			notes: previous.notes,
			scrollByView: {
				...previous.scrollByView,
				[viewMode]: Math.max(0, Math.round(scrollY)),
			},
		});
	} catch {
		// Best effort only.
	}
}

export function readWorkspaceRenderSnapshotScroll(workspaceId: string | null | undefined, viewMode: ViewMode): number | null {
	const snapshot = readWorkspaceRenderSnapshot(workspaceId);
	const scrollY = snapshot?.scrollByView?.[viewMode];
	return typeof scrollY === 'number' && Number.isFinite(scrollY) ? scrollY : null;
}

export function clearWorkspaceRenderSnapshot(workspaceId: string): void {
	if (typeof window === 'undefined' || !workspaceId) return;
	try {
		window.localStorage.removeItem(getSnapshotKey(workspaceId));
	} catch {
		// Ignore storage failures.
	}
}

export function buildWorkspaceRenderSnapshotNote(args: {
	noteId: string;
	doc: Y.Doc;
	reminderAt: string | null;
	collaboratorCount?: number;
	attachmentCounts?: Partial<WorkspaceRenderSnapshotAttachmentCounts>;
	previewCards?: readonly WorkspaceRenderSnapshotPreviewCard[];
}): WorkspaceRenderSnapshotNote {
	const note = readNoteFromDoc(args.doc, args.noteId);
	const metadata = args.doc.getMap<any>('metadata');
	const colorToken = asStringOrNull(metadata.get('colorToken'));
	const bannerFile = note.bannerFile ?? null;
	const checklistArray = note.type === 'checklist' ? args.doc.getArray<Y.Map<any>>('checklist') : null;
	const previewLinks = extractNoteLinksFromDoc(args.doc);
	return {
		id: args.noteId,
		type: note.type,
		title: note.title,
		content: note.type === 'text' ? String(note.content ?? '') : '',
		richContent: note.type === 'text' ? getTextNoteRichPreviewJson(args.doc) : null,
		checklistItems: checklistArray
			? checklistArray.toArray().map((itemMap) => ({
				id: asString(itemMap.get('id')),
				text: asString(itemMap.get('text')),
				completed: Boolean(itemMap.get('completed')),
				completedAt: Number.isFinite(Number(itemMap.get('completedAt'))) ? Number(itemMap.get('completedAt')) : null,
				parentId: asStringOrNull(itemMap.get('parentId')),
				countValue: normalizeChecklistCountValue(itemMap.get('countValue')),
				richContent: getChecklistItemRichPreviewJson(itemMap),
			})).filter((item) => item.id.length > 0)
			: [],
		createdAt: note.createdAt,
		updatedAt: note.updatedAt,
		collectionId: note.collectionId,
		labelIds: [...note.labelIds],
		reminderAt: args.reminderAt,
		isPinned: note.isPinned,
		lastAccessedAt: note.lastAccessedAt,
		drawingIds: [...note.drawingIds],
		trashed: note.trashed,
		archived: note.archived,
		colorToken,
		bannerFile,
		hasSharedBannerPreference: note.hasSharedBannerPreference === true,
		collaboratorCount: Math.max(0, Math.floor(Number(args.collaboratorCount ?? 0) || 0)),
		attachmentCounts: {
			images: Math.max(0, Math.floor(Number(args.attachmentCounts?.images ?? 0) || 0)),
			links: Math.max(0, Math.floor(Number(args.attachmentCounts?.links ?? previewLinks.length) || 0)),
			drawings: Math.max(0, Math.floor(Number(args.attachmentCounts?.drawings ?? 0) || 0)),
		},
		previewLinks,
		previewCards: sanitizePreviewCards(args.previewCards ?? []),
	};
}

export function createSnapshotDocFromWorkspaceRenderSnapshot(note: WorkspaceRenderSnapshotNote): Y.Doc {
	const doc = new Y.Doc();
	const metadata = doc.getMap<any>('metadata');
	metadata.set('type', note.type);
	metadata.set('createdAt', note.createdAt);
	metadata.set('updatedAt', note.updatedAt);
	metadata.set('trashed', note.trashed);
	metadata.set('archived', note.archived);
	metadata.set('collectionId', note.collectionId);
	metadata.set('labelIds', [...note.labelIds]);
	metadata.set('reminderAt', note.reminderAt);
	metadata.set('isPinned', note.isPinned);
	metadata.set('lastAccessedAt', note.lastAccessedAt);
	metadata.set('colorToken', note.colorToken);
	if (note.hasSharedBannerPreference) {
		metadata.set('bannerFile', note.bannerFile ?? null);
	}
	metadata.set('trashedAt', null);
	metadata.set('archivedAt', null);
	setNotePreviewLinksOnDoc(doc, note.previewLinks.map((link) => link.url));

	doc.getText('title').insert(0, note.title);
	if (note.type === 'text') {
		doc.getText('content').insert(0, note.content);
		if (note.richContent) {
			replaceRichFragmentFromJson(doc.getXmlFragment(TEXT_NOTE_RICH_FIELD), note.richContent, 'full');
		}
		return doc;
	}

	const checklist = doc.getArray<Y.Map<any>>('checklist');
	for (const item of note.checklistItems) {
		const itemMap = new Y.Map<any>();
		itemMap.set('id', item.id);
		itemMap.set('text', item.text);
		itemMap.set('completed', item.completed);
		itemMap.set('completedAt', item.completedAt);
		itemMap.set('parentId', item.parentId);
		itemMap.set('countValue', item.countValue);
		if (item.richContent) {
			const richFragment = new Y.XmlFragment();
			itemMap.set(CHECKLIST_ITEM_RICH_FIELD, richFragment);
			replaceRichFragmentFromJson(richFragment, item.richContent, 'minimal');
		}
		checklist.push([itemMap]);
	}
	return doc;
}