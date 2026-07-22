import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CaptureUpdateAction, FONT_FAMILY, Excalidraw, MainMenu, defaultLang, languages, useHandleLibrary } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell, faEllipsisVertical, faPalette, faUserPlus } from '@fortawesome/free-solid-svg-icons';
import { generateKeyBetween } from 'fractional-indexing';
import { ExcalidrawBinding, yjsToExcalidraw } from 'y-excalidraw';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { DRAWING_BACKGROUND_PRESETS, getDrawingRecommendedInkColor, normalizeDrawingBackgroundColor } from '../../core/drawingBackground';
import { getDeviceId } from '../../core/deviceId';
import { useBodyScrollLock } from '../../core/useBodyScrollLock';
import { useI18n } from '../../core/i18n';
import { readEffectiveNoteBannerFile } from '../../core/noteBanners';
import { readEffectiveNoteColorToken, resolveThemeNoteColorModel } from '../../core/noteColors';
import { getUserNoteColorToken, hasUserNoteColorPref, saveUserNoteColorToken, subscribeNoteColorPrefs } from '../../core/noteColorPreferences';
import { getUserNoteBannerFile, subscribeNoteBannerPrefs } from '../../core/noteBannerPreferences';
import { isLightTheme, type ThemeId } from '../../core/theme';
import { consumeStoredLibraryImport, subscribeLibraryImport } from '../../core/excalidrawLibraryImport';
import { useIsCoarsePointer } from '../../core/useIsCoarsePointer';
import { assignDrawingBackgroundColor, assignNoteBannerFile, readNoteMetadataState } from '../../services/noteService';
import { writeNoteBannerWarmCacheFile } from '../../core/noteBannerWarmCache';
import { NoteCardMoreMenu } from '../NoteCard/NoteCardMoreMenu';
import { NoteColorPickerModal } from '../NoteCard/NoteColorPickerModal';
import { NoteBannerPickerModal } from '../NoteCard/NoteBannerPickerModal';
import styles from './Editors.module.css';

type DrawingEditorProps = {
	noteId: string;
	docId?: string | null;
	themeId: ThemeId;
	doc: Y.Doc;
	awareness?: Awareness | null;
	onClose: () => void;
	onSave: () => void | Promise<void>;
	onDelete?: ((noteId: string) => void | Promise<void>) | undefined;
	onAddCollaborator?: (() => void) | undefined;
	onAddImage?: (() => void) | undefined;
	onAddReminder?: (() => void) | undefined;
	onAddToCollection?: (() => void) | undefined;
	onAddLabels?: (() => void) | undefined;
	onTogglePin?: (() => void) | undefined;
	readOnly?: boolean;
	isPendingNew?: boolean;
	userId?: string | null;
};

function useYTextValue(ytext: Y.Text): string {
	return useSyncExternalStore(
		(onStoreChange) => {
			const observer = (): void => onStoreChange();
			ytext.observe(observer);
			return () => ytext.unobserve(observer);
		},
		() => ytext.toString(),
		() => ytext.toString()
	);
}

function setYTextValue(ytext: Y.Text, value: string): void {
	const nextValue = String(value ?? '');
	if (ytext.toString() === nextValue) return;
	ytext.doc?.transact(() => {
		ytext.delete(0, ytext.length);
		if (nextValue.length > 0) {
			ytext.insert(0, nextValue);
		}
	});
}

// Allow any library URL — we trust users to import from wherever they choose.
const allowAllLibraryUrls = (): boolean => true;

// Base key — scoped per-user as `${BASE}:<userId>` to prevent cross-user library leakage.
// Legacy unscoped key (pre-1.6.10) is migrated on first read and then deleted.
const DRAWING_LIBRARY_STORAGE_KEY_BASE = 'freemannotes:excalidraw-library';

function getDrawingLibraryKey(userId: string | null | undefined): string {
	return userId ? `${DRAWING_LIBRARY_STORAGE_KEY_BASE}:${userId}` : DRAWING_LIBRARY_STORAGE_KEY_BASE;
}

function readPersistedDrawingLibrary(userId: string | null | undefined): LibraryItems {
	if (typeof window === 'undefined') return [];
	try {
		const key = getDrawingLibraryKey(userId);
		const raw = window.localStorage.getItem(key);
		if (raw) {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? (parsed as LibraryItems) : [];
		}
		// One-time migration from unscoped legacy key (pre-1.6.10).
		if (userId) {
			const legacyRaw = window.localStorage.getItem(DRAWING_LIBRARY_STORAGE_KEY_BASE);
			if (legacyRaw) {
				const legacyItems = JSON.parse(legacyRaw);
				if (Array.isArray(legacyItems)) {
					persistDrawingLibrary(userId, legacyItems as LibraryItems);
					try { window.localStorage.removeItem(DRAWING_LIBRARY_STORAGE_KEY_BASE); } catch { /* ignore */ }
					return legacyItems as LibraryItems;
				}
			}
		}
		return [];
	} catch {
		return [];
	}
}

function persistDrawingLibrary(userId: string | null | undefined, libraryItems: LibraryItems): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(getDrawingLibraryKey(userId), JSON.stringify(libraryItems));
	} catch {
		// Ignore storage failures. Excalidraw can still function in-memory.
	}
}

function resolveExcalidrawLangCode(locale: string): string {
	const normalized = String(locale || '').trim().toLowerCase().replace(/_/g, '-');
	if (!normalized) return defaultLang.code;
	const exactMatch = languages.find((language) => language.code.toLowerCase() === normalized);
	if (exactMatch) return exactMatch.code;
	const baseLanguage = normalized.split('-')[0] || normalized;
	const baseMatch = languages.find((language) => language.code.toLowerCase() === baseLanguage);
	if (baseMatch) return baseMatch.code;
	const prefixedMatch = languages.find((language) => language.code.toLowerCase().startsWith(`${baseLanguage}-`));
	return prefixedMatch?.code ?? defaultLang.code;
}

type BindingSnapshot = {
	lastKnownElements: Array<{ id: string; version: number; pos: string | null }>;
	lastKnownFileIds: Set<string>;
};

type OrderedBindingElement = { id: string; version: number };
type DrawingSceneElement = ReturnType<ExcalidrawImperativeAPI['getSceneElementsIncludingDeleted']>[number];

function readBindingElementSnapshot(yElements: Y.Array<Y.Map<any>>): BindingSnapshot['lastKnownElements'] {
	return yElements
		.toArray()
		.map((item) => {
			const element = item.get('el') as { id: string; version: number };
			const pos = item.get('pos');
			return {
				id: element.id,
				version: element.version,
				pos: typeof pos === 'string' ? pos : null,
			};
		})
		.sort((left, right) => {
			if (left.pos === right.pos) return 0;
			if (left.pos === null) return -1;
			if (right.pos === null) return 1;
			return left.pos > right.pos ? 1 : -1;
		});
}

function hasInvalidBindingSnapshot(snapshot: BindingSnapshot['lastKnownElements']): boolean {
	let previousPos: string | null = null;
	for (const item of snapshot) {
		if (typeof item.pos !== 'string' || item.pos.length === 0) {
			return true;
		}
		if (previousPos !== null && item.pos <= previousPos) {
			return true;
		}
		previousPos = item.pos;
	}
	return false;
}

function buildNormalizedBindingSnapshot(elements: readonly OrderedBindingElement[]): BindingSnapshot['lastKnownElements'] {
	let previousPos: string | null = null;
	return elements.map((element) => {
		previousPos = generateKeyBetween(previousPos, null);
		return {
			id: element.id,
			version: element.version,
			pos: previousPos,
		};
	});
}

function normalizeExcalidrawColor(value: unknown): string | null {
	const raw = String(value ?? '').trim();
	if (!raw) return null;
	return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)
		? normalizeDrawingBackgroundColor(raw)
		: raw.toLowerCase();
}

function remapAutoInkElements(
	elements: readonly DrawingSceneElement[],
	previousAutoStrokeColor: string | null,
	nextAutoStrokeColor: string
): { elements: readonly DrawingSceneElement[]; changed: boolean } {
	if (!previousAutoStrokeColor || previousAutoStrokeColor === nextAutoStrokeColor) {
		return { elements, changed: false };
	}
	let changed = false;
	const nextElements = elements.map((element) => {
		if (element.isDeleted) return element;
		const strokeColor = normalizeExcalidrawColor(element.strokeColor);
		if (strokeColor !== previousAutoStrokeColor) return element;
		changed = true;
		return {
			...element,
			strokeColor: nextAutoStrokeColor,
			updated: Date.now(),
			version: element.version + 1,
			versionNonce: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
		};
	});
	return changed ? { elements: nextElements, changed } : { elements, changed };
}

function syncActiveWysiwygInk(host: HTMLDivElement | null, strokeColor: string): void {
	if (!host) return;
	const editable = host.querySelector('.excalidraw-wysiwyg');
	if (!(editable instanceof HTMLTextAreaElement)) return;
	editable.style.color = strokeColor;
	editable.style.caretColor = strokeColor;
	editable.style.filter = 'none';
	editable.style.opacity = '1';
}

// Returns a stable key for a selectedElementIds map: sorted truthy keys joined by comma.
// Used to compare values without JSON.stringify ordering ambiguity.
function selectedElementIdsKey(ids: Record<string, boolean | undefined> | null | undefined): string {
	if (!ids) return '';
	return Object.keys(ids).filter((k) => ids[k]).sort().join(',');
}

export function DrawingEditor(props: DrawingEditorProps): React.JSX.Element {
	const { locale, t } = useI18n();
	const isCoarsePointer = useIsCoarsePointer();
	const readOnly = props.readOnly === true;
	const titleYText = useMemo(() => props.doc.getText('title'), [props.doc]);
	const title = useYTextValue(titleYText);
	const metadata = React.useMemo(() => props.doc.getMap<any>('metadata'), [props.doc]);
	const yElements = useMemo(() => props.doc.getArray<Y.Map<any>>('elements'), [props.doc]);
	const yAssets = useMemo(() => props.doc.getMap<any>('assets'), [props.doc]);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const bindingRef = useRef<ExcalidrawBinding | null>(null);
	const initialViewportFitNoteIdRef = useRef<string | null>(null);
	const initialSceneElements = React.useMemo(() => yjsToExcalidraw(yElements), [yElements]);
	const [api, setApi] = React.useState<ExcalidrawImperativeAPI | null>(null);

	// Wrap props.awareness in a Proxy that de-duplicates setLocalStateField("selectedElementIds")
	// calls when the selection hasn't actually changed. y-excalidraw's binding calls this on
	// every onChange, and Yjs awareness always fires a change event even for identical values.
	// Without this guard the cycle is: onChange → setLocalStateField → awareness.change →
	// updateScene({collaborators}) → onChange → … which triggers React error #185 during
	// a collaborative drawing drag (the only scenario where props.awareness is non-null).
	const stableAwareness = React.useMemo((): Awareness | null | undefined => {
		const awareness = props.awareness;
		if (!awareness) return awareness;
		let lastKey = '';
		return new Proxy(awareness, {
			get(target, prop) {
				if (prop === 'setLocalStateField') {
					return (field: string, value: unknown): void => {
						if (field === 'selectedElementIds') {
							const next = selectedElementIdsKey(value as Record<string, boolean | undefined> | null | undefined);
							if (next === lastKey) return;
							lastKey = next;
						}
						target.setLocalStateField(field, value as Parameters<typeof target.setLocalStateField>[1]);
					};
				}
				const val = (target as unknown as Record<string | symbol, unknown>)[prop];
				if (typeof val === 'function') {
					return (val as (...args: unknown[]) => unknown).bind(target);
				}
				return val;
			},
		});
	}, [props.awareness]);

	const [isInitialViewportReady, setIsInitialViewportReady] = React.useState(initialSceneElements.length === 0);
	const [dockPortalHost, setDockPortalHost] = React.useState<HTMLDivElement | null>(null);
	const [isMoreMenuOpen, setIsMoreMenuOpen] = React.useState(false);
	const [moreMenuAnchorRect, setMoreMenuAnchorRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null);
	const [isColorPickerOpen, setIsColorPickerOpen] = React.useState(false);
	const [isBannerPickerOpen, setIsBannerPickerOpen] = React.useState(false);
	const [isHamburgerOpen, setIsHamburgerOpen] = React.useState(false);
	const [moreToolsOpen, setMoreToolsOpen] = React.useState(false);
	const moreToolsTriggerRectRef = React.useRef<DOMRect | null>(null);
	const colorToken = useSyncExternalStore(
		(onStoreChange) => {
			const metadataObserver = (): void => onStoreChange();
			metadata.observe(metadataObserver);
			const unsubscribePrefs = subscribeNoteColorPrefs(onStoreChange);
			return () => {
				metadata.unobserve(metadataObserver);
				unsubscribePrefs();
			};
		},
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId)),
		() => readEffectiveNoteColorToken(metadata, getUserNoteColorToken(props.noteId), hasUserNoteColorPref(props.noteId))
	);
	const noteBannerFile = useSyncExternalStore(
		(onStoreChange) => {
			const metadataObserver = (): void => onStoreChange();
			metadata.observe(metadataObserver);
			const unsubscribePrefs = subscribeNoteBannerPrefs(onStoreChange);
			return () => {
				metadata.unobserve(metadataObserver);
				unsubscribePrefs();
			};
		},
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId)),
		() => readEffectiveNoteBannerFile(metadata, getUserNoteBannerFile(props.noteId))
	);
	const resolvedNoteColor = React.useMemo(
		() => (colorToken ? resolveThemeNoteColorModel(props.themeId).tokens[colorToken] : null),
		[colorToken, props.themeId]
	);
	const drawingBackgroundColor = useSyncExternalStore(
		(onStoreChange) => {
			const metadataObserver = (): void => onStoreChange();
			metadata.observe(metadataObserver);
			return () => metadata.unobserve(metadataObserver);
		},
		() => readNoteMetadataState(props.doc).drawingBackgroundColor,
		() => readNoteMetadataState(props.doc).drawingBackgroundColor
	);
	const persistedDrawingBackgroundRef = useRef(drawingBackgroundColor);
	const autoStrokeColorRef = useRef(getDrawingRecommendedInkColor(drawingBackgroundColor));
	const latestLibraryItemsRef = React.useRef<LibraryItems>([]);
	const libraryServerSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const isPinned = React.useMemo(() => readNoteMetadataState(props.doc).isPinned, [props.doc, metadata, colorToken]);

	const [toolbarScrollPos, setToolbarScrollPos] = React.useState<'start' | 'middle' | 'end'>('start');

	React.useEffect(() => {
		persistedDrawingBackgroundRef.current = drawingBackgroundColor;
	}, [drawingBackgroundColor]);

	React.useEffect(() => {
		if (!isCoarsePointer || !api) return;
		const toolbar = hostRef.current?.querySelector<HTMLElement>('.App-toolbar.App-toolbar--mobile');
		if (!toolbar) return;
		const update = () => {
			const { scrollLeft, scrollWidth, clientWidth } = toolbar;
			if (scrollLeft <= 1) setToolbarScrollPos('start');
			else if (scrollLeft >= scrollWidth - clientWidth - 1) setToolbarScrollPos('end');
			else setToolbarScrollPos('middle');
		};
		toolbar.addEventListener('scroll', update, { passive: true });
		update();
		return () => toolbar.removeEventListener('scroll', update);
	}, [api, isCoarsePointer]);

	const usesMobileEditorLayout = isCoarsePointer;
	const primaryHeaderActionLabel = props.isPendingNew ? t('common.save') : t('common.done');
	const excalidrawLangCode = React.useMemo(() => resolveExcalidrawLangCode(locale), [locale]);

	useBodyScrollLock(true, { disableTouchAction: false });

	// When a library is imported from the Excalidraw library browser it opens a new
	// tab/window of our app with #addLibrary= in the URL.  App.tsx detects the hash,
	// stores the library URL in localStorage, broadcasts it, then closes that relay
	// tab.  We subscribe here and call api.updateLibrary directly — no hash
	// manipulation, no dialogs, no hashchange loops.  localStorage is the fallback
	// for the case where the drawing was closed when the relay fired.
	React.useEffect(() => {
		if (!api || typeof window === 'undefined') return;

		const importLibrary = (libraryUrl: string): void => {
			const blob = fetch(libraryUrl, { mode: 'cors' }).then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.blob();
			});
			void api.updateLibrary({ libraryItems: blob, merge: true, prompt: false, openLibraryMenu: true });
		};

		const stored = consumeStoredLibraryImport();
		if (stored) importLibrary(stored.libraryUrl);

		return subscribeLibraryImport(({ libraryUrl }) => {
			consumeStoredLibraryImport(); // clean up the key App.tsx stored alongside the broadcast
			importLibrary(libraryUrl);
		});
	}, [api]);

	const syncCanvasContrastState = React.useCallback((
		backgroundColor: string,
		force = false,
		recolorExisting = false,
		captureUpdate: CaptureUpdateAction = CaptureUpdateAction.NEVER
	): void => {
		if (!api) return;
		const nextStrokeColor = getDrawingRecommendedInkColor(backgroundColor);
		const previousAutoStrokeColor = normalizeExcalidrawColor(autoStrokeColorRef.current);
		const currentStrokeColor = normalizeExcalidrawColor(api.getAppState().currentItemStrokeColor);
		const sceneElements = api.getSceneElementsIncludingDeleted();
		const shouldUpdateStroke = force
			? !currentStrokeColor || currentStrokeColor === previousAutoStrokeColor || currentStrokeColor === '#000000' || currentStrokeColor === '#ffffff'
			: !currentStrokeColor || currentStrokeColor === previousAutoStrokeColor;
		const nextAppState: Record<string, unknown> = {};
		if (api.getAppState().viewBackgroundColor !== backgroundColor) {
			nextAppState.viewBackgroundColor = backgroundColor;
		}
		if (shouldUpdateStroke && currentStrokeColor !== nextStrokeColor) {
			nextAppState.currentItemStrokeColor = nextStrokeColor;
		}
		const recolored = recolorExisting
			? remapAutoInkElements(sceneElements, previousAutoStrokeColor, nextStrokeColor)
			: { elements: sceneElements, changed: false };
		autoStrokeColorRef.current = nextStrokeColor;
		syncActiveWysiwygInk(hostRef.current, nextStrokeColor);
		if (!recolored.changed && Object.keys(nextAppState).length === 0) return;
		api.updateScene({
			elements: recolored.changed ? recolored.elements : undefined,
			appState: nextAppState,
			captureUpdate,
		});
		api.refresh();
	}, [api]);

	const initialData = React.useMemo(() => {
		const elements = initialSceneElements;
		const recommendedInkColor = getDrawingRecommendedInkColor(drawingBackgroundColor);
		return {
			// Seed the first frame directly from IndexedDB-backed Yjs state so drawings
			// reopen instantly before websocket reconciliation finishes.
			elements,
		appState: {
			activeTool: {
				type: 'selection' as const,
				customType: null,
				locked: true,
				lastActiveTool: null,
			},
			currentItemStrokeColor: recommendedInkColor,
			viewBackgroundColor: drawingBackgroundColor,
			// Default tool style: Nunito text, thin stroke, architect sloppiness (0),
			// sharp edges. These only apply to new drawings; existing drawings restore
			// their own saved appState.
			currentItemFontFamily: FONT_FAMILY.Nunito,
			currentItemRoughness: 0,
			currentItemStrokeWidth: 1,
			currentItemRoundness: 'sharp' as const,
		},
		};
	}, [drawingBackgroundColor, initialSceneElements]);

	React.useEffect(() => {
		initialViewportFitNoteIdRef.current = null;
		setIsInitialViewportReady(initialSceneElements.length === 0);
	}, [initialSceneElements.length, props.noteId]);

	React.useEffect(() => {
		if (!api || typeof window === 'undefined') {
			return;
		}

		let outerFrameId = 0;
		let innerFrameId = 0;
		let revealFrameId = 0;

		const scheduleInitialViewportFit = (elements: readonly ReturnType<ExcalidrawImperativeAPI['getSceneElements']>[number][]): void => {
			if (elements.length === 0) {
				setIsInitialViewportReady(true);
				// Mark initial fit as done so onChange callbacks from the user's first
				// draw don't trigger scrollToContent and jump the new element.
				initialViewportFitNoteIdRef.current = props.noteId;
				return;
			}

			if (initialViewportFitNoteIdRef.current === props.noteId) {
				return;
			}

			if (outerFrameId !== 0) {
				window.cancelAnimationFrame(outerFrameId);
			}
			if (innerFrameId !== 0) {
				window.cancelAnimationFrame(innerFrameId);
			}
			if (revealFrameId !== 0) {
				window.cancelAnimationFrame(revealFrameId);
			}

			outerFrameId = window.requestAnimationFrame(() => {
				outerFrameId = 0;
				innerFrameId = window.requestAnimationFrame(() => {
					innerFrameId = 0;
					const sceneElements = api.getSceneElements();
					if (sceneElements.length === 0 || initialViewportFitNoteIdRef.current === props.noteId) {
						if (sceneElements.length === 0) {
							setIsInitialViewportReady(true);
						}
						return;
					}

					api.scrollToContent(sceneElements, {
						fitToContent: true,
						viewportZoomFactor: usesMobileEditorLayout ? 0.8 : 0.9,
						animate: false,
					});
					initialViewportFitNoteIdRef.current = props.noteId;
					revealFrameId = window.requestAnimationFrame(() => {
						revealFrameId = 0;
						setIsInitialViewportReady(true);
					});
				});
			});
		};

		scheduleInitialViewportFit(api.getSceneElements());
		const unsubscribe = api.onChange((elements) => {
			scheduleInitialViewportFit(elements);
		});

		return () => {
			unsubscribe();
			if (outerFrameId !== 0) {
				window.cancelAnimationFrame(outerFrameId);
			}
			if (innerFrameId !== 0) {
				window.cancelAnimationFrame(innerFrameId);
			}
			if (revealFrameId !== 0) {
				window.cancelAnimationFrame(revealFrameId);
			}
		};
	}, [api, props.noteId, usesMobileEditorLayout]);

	React.useEffect(() => {
		if (!api) {
			return;
		}

		const unsubscribe = api.onChange(() => {
			const binding = bindingRef.current as (ExcalidrawBinding & Partial<BindingSnapshot>) | null;
			if (!binding) {
				return;
			}

			const snapshot = readBindingElementSnapshot(yElements);
			if (snapshot.length === 0) {
				binding.lastKnownElements = snapshot;
				return;
			}

			if (!hasInvalidBindingSnapshot(snapshot)) {
				binding.lastKnownElements = snapshot;
				return;
			}

			const sceneElements = api.getSceneElements();
			const snapshotById = new Map(snapshot.map((item) => [item.id, item]));
			const sceneElementIds = new Set(sceneElements.map((element) => element.id));
			const repairOrder: OrderedBindingElement[] = [
				...sceneElements
					.filter((element) => snapshotById.has(element.id))
					.map((element) => ({ id: element.id, version: element.version })),
				...snapshot
					.filter((item) => !sceneElementIds.has(item.id))
					.map((item) => ({ id: item.id, version: item.version })),
			];

			const normalizedSnapshot = buildNormalizedBindingSnapshot(repairOrder);
			const yItemsById = new Map(yElements.toArray().map((item) => [String((item.get('el') as { id: string }).id), item]));

			yElements.doc?.transact(() => {
				for (const item of normalizedSnapshot) {
					yItemsById.get(item.id)?.set('pos', item.pos);
				}
			}, binding);

			binding.lastKnownElements = normalizedSnapshot;
		});

		return unsubscribe;
	}, [api, yElements]);

	React.useEffect(() => {
		if (!api) return;
		// Seed image files from yAssets into Excalidraw. This covers two cases:
		// 1. IDB has already loaded by the time api mounts → files are available immediately.
		// 2. IDB loads after mount (async) → the yAssets observer fires and adds files then.
		// The ExcalidrawBinding also calls addFiles on WS connect, so these calls are additive.
		const addYAssetFiles = () => {
			const files = [...yAssets.keys()].map((k) => yAssets.get(k)).filter(Boolean);
			if (files.length > 0) {
				api.addFiles(files as Parameters<typeof api.addFiles>[0]);
			}
		};
		addYAssetFiles();
		yAssets.observe(addYAssetFiles);
		return () => {
			yAssets.unobserve(addYAssetFiles);
		};
	}, [api, yAssets]);

	React.useEffect(() => {
		if (!api) return;
		// Defer binding creation until the WebSocket provider's awareness object is
		// available. ExcalidrawBinding immediately calls awareness.getStates() in its
		// constructor — passing undefined crashes with "this.awareness is undefined".
		// stableAwareness (derived from props.awareness) is in the dependency array,
		// so this effect re-runs once the WS provider connects.
		if (stableAwareness == null) return;
		const binding = new ExcalidrawBinding(
			yElements,
			yAssets,
			api,
			stableAwareness as Awareness
		);
		bindingRef.current = binding;
		const bindingWithSnapshot = binding as ExcalidrawBinding & Partial<BindingSnapshot>;
		bindingWithSnapshot.lastKnownElements = readBindingElementSnapshot(yElements);
		bindingWithSnapshot.lastKnownFileIds = new Set(Array.from(yAssets.keys()));
		return () => {
			bindingRef.current = null;
			binding.destroy();
		};
	}, [api, stableAwareness, yAssets, yElements]);

	React.useEffect(() => {
		const binding = bindingRef.current;
		const host = hostRef.current;
		if (!binding || !host) return;

		const undoManager = new Y.UndoManager(yElements);
		undoManager.addTrackedOrigin(binding);

		const isUndoShortcut = (event: KeyboardEvent): boolean => {
			const usesModifier = event.ctrlKey || event.metaKey;
			return usesModifier && !event.shiftKey && event.key?.toLowerCase() === 'z';
		};
		const isRedoShortcut = (event: KeyboardEvent): boolean => {
			const usesModifier = event.ctrlKey || event.metaKey;
			const key = event.key?.toLowerCase();
			return (usesModifier && event.shiftKey && key === 'z') || (event.ctrlKey && !event.shiftKey && key === 'y');
		};

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (isRedoShortcut(event)) {
				event.stopPropagation();
				undoManager.redo();
				return;
			}
			if (isUndoShortcut(event)) {
				event.stopPropagation();
				undoManager.undo();
			}
		};

		let undoButton: HTMLButtonElement | null = null;
		let redoButton: HTMLButtonElement | null = null;

		const handleUndoClick = (event: Event): void => {
			event.stopImmediatePropagation();
			undoManager.undo();
		};
		const handleRedoClick = (event: Event): void => {
			event.stopImmediatePropagation();
			undoManager.redo();
		};

		const syncUndoRedoButtons = (): void => {
			const nextUndoButton = host.querySelector<HTMLButtonElement>('[data-testid="button-undo"]');
			if (nextUndoButton !== undoButton) {
				undoButton?.removeEventListener('click', handleUndoClick, true);
				undoButton = nextUndoButton;
				undoButton?.addEventListener('click', handleUndoClick, true);
			}

			const nextRedoButton = host.querySelector<HTMLButtonElement>('[data-testid="button-redo"]');
			if (nextRedoButton !== redoButton) {
				redoButton?.removeEventListener('click', handleRedoClick, true);
				redoButton = nextRedoButton;
				redoButton?.addEventListener('click', handleRedoClick, true);
			}
		};

		host.addEventListener('keydown', handleKeyDown, { capture: true });
		const mutationObserver = new MutationObserver(() => {
			syncUndoRedoButtons();
		});
		mutationObserver.observe(host, {
			childList: true,
			subtree: true,
		});
		syncUndoRedoButtons();

		return () => {
			host.removeEventListener('keydown', handleKeyDown, { capture: true });
			undoButton?.removeEventListener('click', handleUndoClick, true);
			redoButton?.removeEventListener('click', handleRedoClick, true);
			mutationObserver.disconnect();
			undoManager.removeTrackedOrigin(binding);
			undoManager.destroy();
		};
	}, [api, yElements]);


	React.useEffect(() => {
		const binding = bindingRef.current as (ExcalidrawBinding & Partial<BindingSnapshot>) | null;
		if (!binding) {
			return;
		}

		binding.lastKnownElements = readBindingElementSnapshot(yElements);
		binding.lastKnownFileIds = new Set(Array.from(yAssets.keys()));
	}, [usesMobileEditorLayout, yAssets, yElements]);
	React.useEffect(() => {
		autoStrokeColorRef.current = getDrawingRecommendedInkColor(drawingBackgroundColor);
	}, [props.noteId]);

	React.useEffect(() => {
		if (!api) return;

		const activeTool = api.getAppState().activeTool;
		if (activeTool.locked) return;

		api.updateScene({
			appState: {
				activeTool: {
					...activeTool,
					locked: true,
				},
			},
			captureUpdate: CaptureUpdateAction.NEVER,
		});
		api.refresh();
	}, [api]);

	React.useEffect(() => {
		if (!api) return;

		const nextBackground = drawingBackgroundColor;
		if (!nextBackground) return;
		persistedDrawingBackgroundRef.current = nextBackground;
		syncCanvasContrastState(nextBackground, true, false, CaptureUpdateAction.NEVER);
	}, [api, drawingBackgroundColor, syncCanvasContrastState]);

	// Sync Excalidraw's offsetTop/offsetLeft with the canvas element's actual
	// position in the viewport. Without this, pointer events are miscalculated
	// and first-click anchors land at the wrong scene position. Previously
	// guarded on `usesMobileEditorLayout` — removed so desktop editors (where
	// the canvas may be offset by a header/toolbar) are also corrected.
	React.useEffect(() => {
		if (!api || typeof window === 'undefined') return;

		let frameId = 0;
		const syncViewportOffsets = (): void => {
			frameId = 0;
			const host = hostRef.current;
			if (!host) return;

			// Measure Excalidraw's own root element when available — it's the element
			// Excalidraw uses for its own internal offset computations, so this is
			// more accurate than the host wrapper div (which may be a scroll container
			// with overflow-x:auto on desktop, adding scroll offset ambiguity).
			const excalidrawRoot = host.querySelector<HTMLElement>('.excalidraw') ?? host;
			const rect = excalidrawRoot.getBoundingClientRect();
			const nextOffsetTop = Math.max(0, Math.round(rect.top));
			const nextOffsetLeft = Math.max(0, Math.round(rect.left));
			const currentAppState = api.getAppState();
			if (
				currentAppState.offsetTop === nextOffsetTop &&
				currentAppState.offsetLeft === nextOffsetLeft
			) {
				return;
			}

			api.updateScene({
				appState: {
					offsetTop: nextOffsetTop,
					offsetLeft: nextOffsetLeft,
				},
				captureUpdate: CaptureUpdateAction.NEVER,
			});
			api.refresh();
		};

		const scheduleSync = (): void => {
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			frameId = window.requestAnimationFrame(syncViewportOffsets);
		};

		scheduleSync();

		// The editor may animate open (slide/fade). ResizeObserver only fires on
		// SIZE changes, so it misses position changes from CSS transforms. Schedule
		// additional syncs after the api first becomes available to catch the final
		// settled position after any open animation completes.
		const t1 = setTimeout(scheduleSync, 100);
		const t2 = setTimeout(scheduleSync, 350);
		const t3 = setTimeout(scheduleSync, 700);

		const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => scheduleSync()) : null;
		if (resizeObserver && hostRef.current) {
			resizeObserver.observe(hostRef.current);
			if (hostRef.current.parentElement) {
				resizeObserver.observe(hostRef.current.parentElement);
			}
		}

		window.addEventListener('resize', scheduleSync);
		window.visualViewport?.addEventListener('resize', scheduleSync);
		window.visualViewport?.addEventListener('scroll', scheduleSync);

		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
			clearTimeout(t3);
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			resizeObserver?.disconnect();
			window.removeEventListener('resize', scheduleSync);
			window.visualViewport?.removeEventListener('resize', scheduleSync);
			window.visualViewport?.removeEventListener('scroll', scheduleSync);
		};
	}, [api, usesMobileEditorLayout]);

	React.useEffect(() => {
		const host = hostRef.current;
		if (!host || typeof MutationObserver === 'undefined') return;

		// Excalidraw mounts and restyles the live text textarea outside normal scene
		// updates, so keep its ink synchronized while the user is still typing.
		const syncCurrentEditorInk = (): void => {
			const strokeColor = normalizeExcalidrawColor(api?.getAppState().currentItemStrokeColor) ?? autoStrokeColorRef.current;
			if (!strokeColor) return;
			syncActiveWysiwygInk(host, strokeColor);
		};

		syncCurrentEditorInk();
		const observer = new MutationObserver(() => {
			syncCurrentEditorInk();
		});
		observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
		return () => {
			observer.disconnect();
		};
	}, [api]);

	React.useEffect(() => {
		if (!usesMobileEditorLayout || typeof window === 'undefined') {
			setDockPortalHost(null);
			return;
		}

		const host = hostRef.current;
		if (!host) {
			setDockPortalHost(null);
			return;
		}

		let frameId = 0;
		let observer: MutationObserver | null = null;

		const attachDockHost = (): boolean => {
			const toolbarContent = host.querySelector('.App-bottom-bar .App-toolbar-content');
			if (!(toolbarContent instanceof HTMLElement)) {
				return false;
			}

			let anchor = toolbarContent.querySelector('[data-drawing-dock-anchor="true"]');
			if (!(anchor instanceof HTMLDivElement)) {
				const nextAnchor = document.createElement('div');
				nextAnchor.dataset.drawingDockAnchor = 'true';
				nextAnchor.className = styles.drawingBottomDockInline;
				// Append at end so our buttons (⋮ 🎨 🔔 👤+) come after all native
				// tool buttons; the toolbar scrolls horizontally to reach them.
				toolbarContent.appendChild(nextAnchor);
				anchor = nextAnchor;
			}
			if (!(anchor instanceof HTMLDivElement)) return false;

			setDockPortalHost(anchor);
			return true;
		};

		const scheduleAttach = (): void => {
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				attachDockHost();
			});
		};

		if (!attachDockHost()) {
			observer = new MutationObserver(() => {
				if (attachDockHost()) {
					observer?.disconnect();
					observer = null;
				}
			});
			observer.observe(host, { childList: true, subtree: true });
			scheduleAttach();
		}

		return () => {
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			observer?.disconnect();
			setDockPortalHost((current) => {
				current?.remove();
				return null;
			});
		};
	}, [usesMobileEditorLayout]);

	React.useEffect(() => {
		if (!usesMobileEditorLayout || typeof window === 'undefined') {
			return;
		}

		const host = hostRef.current;
		if (!host) {
			return;
		}

		let frameId = 0;
		let observer: MutationObserver | null = null;
		let relocatedHandTool: HTMLElement | null = null;
		let originalParent: HTMLElement | null = null;
		let originalNextSibling: ChildNode | null = null;

		const restoreHandTool = (): void => {
			if (!relocatedHandTool || !originalParent?.isConnected) {
				relocatedHandTool = null;
				originalParent = null;
				originalNextSibling = null;
				return;
			}

			originalParent.insertBefore(relocatedHandTool, originalNextSibling);
			relocatedHandTool = null;
			originalParent = null;
			originalNextSibling = null;
		};

		const attachHandTool = (): boolean => {
			const toolbarRow = host.querySelector('.App-toolbar .Stack.Stack_horizontal');
			const handTool = host.querySelector('label.ToolIcon.Shape[title^="Hand (panning tool)"]');
			if (!(toolbarRow instanceof HTMLElement) || !(handTool instanceof HTMLElement)) {
				return false;
			}

			if (handTool.parentElement === toolbarRow) {
				return true;
			}

			originalParent = handTool.parentElement;
			originalNextSibling = handTool.nextSibling;
			relocatedHandTool = handTool;

			const moreToolsButton = toolbarRow.querySelector('button[title="More tools"]');
			toolbarRow.insertBefore(handTool, moreToolsButton instanceof HTMLElement ? moreToolsButton : null);
			return true;
		};

		const scheduleAttach = (): void => {
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				attachHandTool();
			});
		};

		if (!attachHandTool()) {
			observer = new MutationObserver(() => {
				attachHandTool();
			});
			observer.observe(host, { childList: true, subtree: true });
			scheduleAttach();
		}

		return () => {
			if (frameId !== 0) {
				window.cancelAnimationFrame(frameId);
			}
			observer?.disconnect();
			restoreHandTool();
		};
	}, [usesMobileEditorLayout]);

	// Track whether the Excalidraw hamburger (main) menu is open so we can hide
	// the "Done" button on mobile — users were accidentally closing the editor
	// by tapping "Done" instead of the hamburger icon to close the menu.
	React.useEffect(() => {
		if (!usesMobileEditorLayout || typeof MutationObserver === 'undefined') {
			setIsHamburgerOpen(false);
			return;
		}
		const host = hostRef.current;
		if (!host) return;

		const update = (): void => {
			// The hamburger dropdown renders as .dropdown-menu--mobile.
			// The "More tools" dropdown also uses dropdown-menu--mobile but adds
			// the App-toolbar__extra-tools-dropdown class — exclude it.
			const hamburger = host.querySelector('.dropdown-menu--mobile:not(.App-toolbar__extra-tools-dropdown)');
			setIsHamburgerOpen(!!hamburger);
		};

		update();
		const observer = new MutationObserver(update);
		observer.observe(host, { childList: true, subtree: true });
		return () => { observer.disconnect(); setIsHamburgerOpen(false); };
	}, [usesMobileEditorLayout]);

	// Mirror the native Excalidraw extra-tools dropdown state into moreToolsOpen.
	// The native dropdown is hidden via CSS (display:none); we render our own portal
	// to document.body so it's guaranteed above .fullscreenOverlay's stacking context.
	React.useEffect(() => {
		if (!usesMobileEditorLayout || typeof MutationObserver === 'undefined') return;
		const host = hostRef.current;
		if (!host) return;

		let prevHasDropdown = false;
		let frameId = 0;
		let closeTimeoutId: ReturnType<typeof setTimeout> | null = null;

		const sync = (): void => {
			const hasDropdown = !!host.querySelector('.App-toolbar__extra-tools-dropdown');
			if (hasDropdown === prevHasDropdown) return;
			prevHasDropdown = hasDropdown;

			if (!hasDropdown) {
				if (frameId) { window.cancelAnimationFrame(frameId); frameId = 0; }
				// Defer by one macrotask: Excalidraw's useOutsideClick fires on
				// pointerdown (which precedes click). Without this delay the portal
				// unmounts before the item's click handler can execute.
				if (closeTimeoutId !== null) clearTimeout(closeTimeoutId);
				closeTimeoutId = setTimeout(() => {
					closeTimeoutId = null;
					setMoreToolsOpen(false);
				}, 0);
				return;
			}
			if (closeTimeoutId !== null) { clearTimeout(closeTimeoutId); closeTimeoutId = null; }
			// Measure trigger position after layout settles (MutationObserver fires
			// before paint, so getBoundingClientRect may return 0 immediately).
			frameId = window.requestAnimationFrame(() => {
				frameId = 0;
				const trigger = host.querySelector<HTMLElement>('.App-toolbar__extra-tools-trigger');
				if (!trigger) return;
				moreToolsTriggerRectRef.current = trigger.getBoundingClientRect();
				setMoreToolsOpen(true);
			});
		};

		const observer = new MutationObserver(sync);
		observer.observe(host, { childList: true, subtree: true });
		sync();

		return () => {
			observer.disconnect();
			if (frameId) window.cancelAnimationFrame(frameId);
			if (closeTimeoutId !== null) clearTimeout(closeTimeoutId);
			setMoreToolsOpen(false);
		};
	}, [usesMobileEditorLayout]);

	const handleSelectNoteColor = React.useCallback((token: Parameters<typeof saveUserNoteColorToken>[2]): void => {
		saveUserNoteColorToken(getDeviceId(), props.noteId, token);
		setIsColorPickerOpen(false);
	}, [props.noteId]);

	const handleSelectCanvasBackground = React.useCallback((color: string): void => {
		const normalizedColor = normalizeDrawingBackgroundColor(color);
		if (!normalizedColor) return;
		persistedDrawingBackgroundRef.current = normalizedColor;
		assignDrawingBackgroundColor(props.doc, normalizedColor);
		syncCanvasContrastState(normalizedColor, true, true, CaptureUpdateAction.IMMEDIATELY);
	}, [props.doc, syncCanvasContrastState]);

	const handleDrawingSceneChange = React.useCallback((
		_elements: readonly unknown[],
		appState: { viewBackgroundColor: string; currentItemStrokeColor?: string; selectedElementIds?: Record<string, boolean | undefined> }
	): void => {
		const liveStrokeColor = normalizeExcalidrawColor(appState.currentItemStrokeColor) ?? normalizeExcalidrawColor(api?.getAppState().currentItemStrokeColor) ?? autoStrokeColorRef.current;
		if (liveStrokeColor) {
			syncActiveWysiwygInk(hostRef.current, liveStrokeColor);
		}
		const nextBackground = normalizeDrawingBackgroundColor(appState.viewBackgroundColor);
		if (nextBackground && nextBackground !== persistedDrawingBackgroundRef.current) {
			persistedDrawingBackgroundRef.current = nextBackground;
			assignDrawingBackgroundColor(props.doc, nextBackground);
		}
	}, [api, props.doc]);

	// Close the custom more-tools dropdown AND sync the native Excalidraw state.
	// Without the trigger click, Excalidraw still thinks the dropdown is open;
	// the next DOM mutation would re-trigger our observer and reopen the custom dropdown.
	const closeMoreTools = React.useCallback((): void => {
		setMoreToolsOpen(false);
		const host = hostRef.current;
		if (host?.querySelector('.App-toolbar__extra-tools-dropdown')) {
			host.querySelector<HTMLElement>('.App-toolbar__extra-tools-trigger')?.click();
		}
	}, []);

	// useHandleLibrary wires up:
	// 1. Initial library load (server as source of truth, localStorage as offline cache)
	// 2. Auto-save on modification (localStorage immediately, server debounced 2 s)
	// Library imports are handled above via api.updateLibrary — no hash manipulation.
	const libraryAdapter = React.useMemo(() => ({
		load: async (): Promise<{ libraryItems: LibraryItems }> => {
			const localItems = readPersistedDrawingLibrary(props.userId);
			if (!props.userId) return { libraryItems: localItems };
			try {
				const res = await fetch('/api/drawing-library', { credentials: 'include' });
				if (res.ok) {
					const data = await res.json() as { libraryItems?: unknown };
					const serverItems = Array.isArray(data?.libraryItems) ? (data.libraryItems as LibraryItems) : [];
					persistDrawingLibrary(props.userId, serverItems);
					return { libraryItems: serverItems };
				}
			} catch {
				// Offline or unauthenticated — fall through to local cache
			}
			return { libraryItems: localItems };
		},
		save: async (data: { libraryItems: LibraryItems }): Promise<void> => {
			persistDrawingLibrary(props.userId, data.libraryItems);
			if (!props.userId) return;
			latestLibraryItemsRef.current = data.libraryItems;
			if (libraryServerSaveTimerRef.current !== null) clearTimeout(libraryServerSaveTimerRef.current);
			libraryServerSaveTimerRef.current = setTimeout(() => {
				libraryServerSaveTimerRef.current = null;
				const items = latestLibraryItemsRef.current;
				void fetch('/api/drawing-library', {
					method: 'PUT',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ libraryItems: items }),
				});
			}, 2000);
		},
	}), [props.userId]);

	useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter, validateLibraryUrl: allowAllLibraryUrls });

	const handleExcalidrawAPI = React.useCallback((excalidrawApi: ExcalidrawImperativeAPI): void => {
		setApi(excalidrawApi);
	}, []);

	const content = (
		<div className={styles.fullscreenOverlay} role="presentation">
			<section
				aria-label={`Drawing ${props.noteId}`}
				className={`${styles.fullscreenEditor} ${styles.editorContainer}`}
				style={{
					background: resolvedNoteColor?.cardBackground ?? 'var(--color-editor-surface, var(--color-background))',
					gap: 0,
					padding: 0,
					overflow: 'hidden',
				}}
			>
				<div
					style={{
						display: 'flex',
						position: 'relative',
						zIndex: 3,
						alignItems: 'center',
						gap: 10,
						justifyContent: 'space-between',
						padding: isCoarsePointer ? '10px 12px' : '12px 16px',
						borderBottom: isCoarsePointer
							? 'none'
							: `1px solid ${resolvedNoteColor?.borderColor ?? 'color-mix(in srgb, var(--color-border, #444) 72%, transparent)'}`,
						background: resolvedNoteColor?.cardBackground ?? 'color-mix(in srgb, var(--color-surface, #111) 92%, transparent)',
						flex: '0 0 auto',
					}}
				>
					<input
						type="text"
						className={styles.editorTitleInput}
						style={{
							margin: 0,
							background: 'transparent',
							border: 'none',
							boxShadow: 'none',
							padding: 0,
							minWidth: 0,
							width: '100%',
							fontSize: isCoarsePointer ? '1rem' : '1.05rem',
							fontWeight: 700,
						}}
						value={title}
						placeholder={t('editors.titlePlaceholder')}
						readOnly={readOnly}
						onChange={(event) => setYTextValue(titleYText, event.target.value)}
					/>
					<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
						{props.isPendingNew ? (
							<button
								type="button"
								onClick={props.onClose}
								style={{
									borderRadius: 999,
									padding: '8px 12px',
									font: 'inherit',
									fontWeight: 700,
									cursor: 'pointer',
									background: 'transparent',
									color: resolvedNoteColor?.textColor ?? 'var(--color-text, inherit)',
									border: `1px solid ${resolvedNoteColor?.borderColor ?? 'var(--color-border, rgba(128,128,128,0.4))'}`,
								}}
							>
								{t('common.cancel')}
							</button>
						) : null}
						{/* Hide "Done" when the hamburger menu is open on mobile so users
						    don't accidentally close the editor instead of closing the menu. */}
						{(!usesMobileEditorLayout || !isHamburgerOpen) ? (
							<button
								type="button"
								onClick={props.onSave}
								style={{
									border: 0,
									borderRadius: 999,
									padding: '8px 12px',
									font: 'inherit',
									fontWeight: 700,
									cursor: 'pointer',
									background: 'var(--color-accent, #1d4ed8)',
									color: 'white',
								}}
							>
								{primaryHeaderActionLabel}
							</button>
						) : null}
					</div>
				</div>
				<div
					ref={hostRef}
					data-toolbar-scroll={isCoarsePointer ? toolbarScrollPos : undefined}
					className={`${styles.drawingCanvasHost} ${isCoarsePointer ? styles.drawingCanvasHostTouch : ''}${isHamburgerOpen ? ` ${styles.drawingHamburgerOpen}` : ''}`}
					style={{
						position: 'relative',
						minHeight: 0,
						minWidth: 0,
						flex: '1 1 auto',
						visibility: isInitialViewportReady ? 'visible' : 'hidden',
					}}
				>
					<Excalidraw
						initialData={initialData}
						excalidrawAPI={handleExcalidrawAPI}
						langCode={excalidrawLangCode}
						onChange={handleDrawingSceneChange}
						onPointerUpdate={(payload) => bindingRef.current?.onPointerUpdate(payload)}
						viewModeEnabled={readOnly}
						handleKeyboardGlobally
						autoFocus={!readOnly}
						libraryReturnUrl={typeof window === 'undefined' ? undefined : window.location.href}
						name={title.trim() || t('note.untitled')}
						theme={isLightTheme(props.themeId) ? 'light' : 'dark'}
						UIOptions={{
							dockedSidebarBreakpoint: usesMobileEditorLayout ? 9_999 : undefined,
							canvasActions: {
								changeViewBackgroundColor: false,
								loadScene: false,
								saveToActiveFile: false,
							},
						}}
					>
						<MainMenu>
							<MainMenu.DefaultItems.LoadScene />
							<MainMenu.DefaultItems.SaveToActiveFile />
							<MainMenu.DefaultItems.Export />
							<MainMenu.DefaultItems.SaveAsImage />
							<MainMenu.Separator />
							<MainMenu.DefaultItems.SearchMenu />
							<MainMenu.DefaultItems.CommandPalette />
							<MainMenu.Separator />
							<MainMenu.ItemCustom>
								<div className={styles.drawingMainMenuSection}>
									<div className={styles.drawingMainMenuSectionTitle}>{t('drawings.canvasBackground')}</div>
									<div className={styles.drawingMainMenuColorGrid} role="list" aria-label={t('drawings.canvasBackgroundColors')}>
										{DRAWING_BACKGROUND_PRESETS.map((preset) => {
											const isActive = drawingBackgroundColor.toLowerCase() === preset.color.toLowerCase();
											return (
												<button
													key={preset.id}
													type="button"
													role="listitem"
													className={`${styles.drawingMainMenuColorButton}${isActive ? ` ${styles.drawingMainMenuColorButtonActive}` : ''}`}
													onClick={() => handleSelectCanvasBackground(preset.color)}
													aria-label={preset.label}
													title={preset.label}
												>
													<span
														className={styles.drawingMainMenuColorSwatch}
														aria-hidden="true"
														style={{ background: preset.color }}
													/>
												</button>
											);
										})}
									</div>
								</div>
							</MainMenu.ItemCustom>
							<MainMenu.Separator />
							<MainMenu.DefaultItems.ToggleTheme />
							<MainMenu.DefaultItems.ClearCanvas />
							<MainMenu.DefaultItems.Help />
						</MainMenu>
					</Excalidraw>
				</div>
				{!usesMobileEditorLayout ? (
					<nav className={styles.drawingDesktopDock} aria-label={t('editors.bottomDock')}>
						<div className={styles.bottomDockLeft}>
							<button
								type="button"
								className={styles.bottomDockButton}
								aria-label={t('editors.dockAction')}
								onClick={(event) => {
									setMoreMenuAnchorRect(event.currentTarget.getBoundingClientRect().toJSON());
									setIsMoreMenuOpen(true);
								}}
							>
								<FontAwesomeIcon icon={faEllipsisVertical} />
							</button>
							<button
								type="button"
								className={styles.bottomDockButton}
								aria-label={t('noteColors.dialogTitle')}
								onClick={() => setIsColorPickerOpen(true)}
								disabled={readOnly}
							>
								<span
									className={styles.drawingBottomDockColorSwatch}
									aria-hidden="true"
									style={resolvedNoteColor ? {
										background: `linear-gradient(180deg, ${resolvedNoteColor.headerBackground}, ${resolvedNoteColor.cardBackground})`,
										borderColor: resolvedNoteColor.borderColor,
									} : undefined}
								/>
							</button>
							<button
								type="button"
								className={styles.bottomDockButton}
								aria-label={t('noteMenu.addReminder')}
								onClick={() => props.onAddReminder?.()}
								disabled={!props.onAddReminder}
							>
								<FontAwesomeIcon icon={faBell} />
							</button>
							<button
								type="button"
								className={styles.bottomDockButton}
								aria-label={t('noteMenu.addCollaborator')}
								onClick={() => props.onAddCollaborator?.()}
								disabled={!props.onAddCollaborator}
							>
								<FontAwesomeIcon icon={faUserPlus} />
							</button>
						</div>
					</nav>
				) : null}
			</section>
			{dockPortalHost && usesMobileEditorLayout ? createPortal(
				<>
					<button
						type="button"
						className={styles.drawingBottomDockActionButton}
						aria-label={t('editors.dockAction')}
						onClick={(event) => {
							setMoreMenuAnchorRect(event.currentTarget.getBoundingClientRect().toJSON());
							setIsMoreMenuOpen(true);
						}}
					>
						<FontAwesomeIcon icon={faEllipsisVertical} />
					</button>
					<button
						type="button"
						className={styles.drawingBottomDockActionButton}
						aria-label={t('noteColors.dialogTitle')}
						onClick={() => setIsColorPickerOpen(true)}
						disabled={readOnly}
					>
						<FontAwesomeIcon icon={faPalette} />
					</button>
					<button
						type="button"
						className={styles.drawingBottomDockActionButton}
						aria-label={t('noteMenu.addReminder')}
						onClick={() => props.onAddReminder?.()}
						disabled={!props.onAddReminder}
					>
						<FontAwesomeIcon icon={faBell} />
					</button>
					<button
						type="button"
						className={styles.drawingBottomDockActionButton}
						aria-label={t('noteMenu.addCollaborator')}
						onClick={() => props.onAddCollaborator?.()}
						disabled={!props.onAddCollaborator}
					>
						<FontAwesomeIcon icon={faUserPlus} />
					</button>
				</>,
				dockPortalHost
			) : null}
			{isMoreMenuOpen ? (
				<NoteCardMoreMenu
					noteType="text"
					showAddDocument={false}
					showAddImage={false}
					anchorRect={moreMenuAnchorRect}
					isPinned={isPinned}
					onClose={() => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
					}}
					onTogglePin={props.onTogglePin ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onTogglePin?.();
					} : undefined}
					onAddCollaborator={props.onAddCollaborator ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onAddCollaborator?.();
					} : undefined}
					onAddImage={props.onAddImage ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onAddImage?.();
					} : undefined}
					onSelectBannerImage={!readOnly ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						setIsBannerPickerOpen(true);
					} : undefined}
					onAddReminder={props.onAddReminder ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onAddReminder?.();
					} : undefined}
					onAddToCollection={props.onAddToCollection ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onAddToCollection?.();
					} : undefined}
					onAddLabels={props.onAddLabels ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						props.onAddLabels?.();
					} : undefined}
					onTrash={props.onDelete ? () => {
						setIsMoreMenuOpen(false);
						setMoreMenuAnchorRect(null);
						void props.onDelete?.(props.noteId);
					} : undefined}
				/>
			) : null}
			<NoteColorPickerModal
				isOpen={isColorPickerOpen}
				themeId={props.themeId}
				selectedToken={colorToken}
				onClose={() => setIsColorPickerOpen(false)}
				onSelect={handleSelectNoteColor}
			/>
			<NoteBannerPickerModal
				isOpen={isBannerPickerOpen}
				themeId={props.themeId}
				selectedFileName={noteBannerFile}
				onClose={() => setIsBannerPickerOpen(false)}
				onSelect={(fileName) => {
					assignNoteBannerFile(props.doc, fileName);
					writeNoteBannerWarmCacheFile(props.noteId, fileName);
					setIsBannerPickerOpen(false);
				}}
			/>
			{(() => {
				const triggerRect = moreToolsOpen ? moreToolsTriggerRectRef.current : null;
				if (!triggerRect || typeof document === 'undefined') return null;
				return createPortal(
					<>
						{/* Backdrop: closes on tap outside without blocking Excalidraw's own useOutsideClick */}
						<div
							style={{ position: 'fixed', inset: 0, zIndex: 99998 }}
							aria-hidden="true"
							onPointerDown={() => setMoreToolsOpen(false)}
						/>
						<div
							className={styles.moreToolsDropdown}
							style={{
								position: 'fixed',
								bottom: window.innerHeight - triggerRect.top + 4,
								right: Math.max(8, window.innerWidth - triggerRect.right),
								zIndex: 99999,
							}}
						>
							<button
								className={styles.moreToolsDropdownItem}
								onClick={() => { api?.setActiveTool({ type: 'frame' }); closeMoreTools(); }}
							>
								Frame
							</button>
							<button
								className={styles.moreToolsDropdownItem}
								onClick={() => { api?.setActiveTool({ type: 'embeddable' }); closeMoreTools(); }}
							>
								Embed
							</button>
							<button
								className={styles.moreToolsDropdownItem}
								onClick={() => { api?.setActiveTool({ type: 'laser' }); closeMoreTools(); }}
							>
								Laser
							</button>
						</div>
					</>,
					document.body
				);
			})()}
		</div>
	);

	return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}