import React from 'react';
import type * as Y from 'yjs';
import fabIconDark from '../version.png';
import fabIconLight from '../version-light.png';
import { ChecklistEditor } from './components/Editors/ChecklistEditor';
import { NoteEditor } from './components/Editors/NoteEditor';
import { PreferencesModal } from './components/Preferences/PreferencesModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid } from './components/NoteGrid/NoteGrid';
import { type ChecklistItem } from './core/bindings';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId } from './core/noteModel';
import { applyTheme, getStoredThemeId, persistThemeId, THEMES, type ThemeId } from './core/theme';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';

type EditorMode = 'none' | 'text' | 'checklist';

export function App(): React.JSX.Element {
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const { t, locale, locales, setLocale } = useI18n();
	const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
	// The currently selected note in the grid/editor area.
	const [selectedNoteId, setSelectedNoteId] = React.useState<string | null>(null);
	// Loaded Y.Doc for the selected note.
	const [openDoc, setOpenDoc] = React.useState<Y.Doc | null>(null);
	const [openDocId, setOpenDocId] = React.useState<string | null>(null);
	const [themeId, setThemeId] = React.useState<ThemeId>(() => getStoredThemeId());
	const [searchQuery, setSearchQuery] = React.useState('');
	const [isFabOpen, setIsFabOpen] = React.useState(false);
	const isCoarsePointer = useIsCoarsePointer();
	const maxCardHeightPx = isCoarsePointer ? 450 : 615;

	React.useEffect(() => {
		applyTheme(themeId);
		persistThemeId(themeId);
	}, [themeId]);

	const themeOptions = React.useMemo(() => {
		return THEMES.map((theme) => ({ id: theme.id, label: t(theme.labelKey) }));
	}, [t]);

	const languageOptions = React.useMemo(() => {
		return locales.map((entry) => ({ code: entry.code, label: entry.label }));
	}, [locales]);

	const fabIconSrc = React.useMemo(() => {
		return themeId === 'light' ? fabIconDark : fabIconLight;
	}, [themeId]);

	const sidebarSections = React.useMemo(
		() => [
			t('app.sidebarNotes'),
			t('app.sidebarImages'),
			t('app.sidebarReminders'),
			t('app.sidebarLabels'),
			t('app.sidebarSorting'),
			t('app.sidebarCollections'),
			t('app.sidebarArchive'),
			t('app.sidebarTrash'),
		],
		[t]
	);

	React.useEffect(() => {
		// Keep card max-height token in sync with responsive desktop/mobile defaults.
		const root = document.documentElement;
		root.style.setProperty('--note-card-max-height', `${maxCardHeightPx}px`);
		return () => {
			root.style.removeProperty('--note-card-max-height');
		};
	}, [maxCardHeightPx]);

	const onSaveText = React.useCallback(
		async (args: { title: string; body: string }) => {
			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('text-note');
			const doc = await manager.getDocWithSync(id);
			initTextNoteDoc(doc, args.title, args.body);
			await manager.createNote(id, args.title);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	const onSaveChecklist = React.useCallback(
		async (args: { title: string; items: ChecklistItem[] }) => {
			// All note creation goes through the canonical noteModel factory functions.
			const id = makeNoteId('checklist-note');
			const doc = await manager.getDocWithSync(id);
			initChecklistNoteDoc(doc, args.title, args.items);
			await manager.createNote(id, args.title);
			setEditorMode('none');
			// Branch: auto-open newly created note.
			setSelectedNoteId(id);
		},
		[manager]
	);

	const onDeleteSelectedNote = React.useCallback(
		async (noteId: string) => {
			// Soft-delete: mark as trashed in the Yjs metadata. The note stays
			// in the registry and order arrays but is hidden from the main grid.
			// Server-side cleanup permanently removes it after deleteAfterDays.
			await manager.trashNote(noteId);
			setSelectedNoteId((prev) => (prev === noteId ? null : prev));
			setOpenDocId((prevId) => {
				if (prevId !== noteId) return prevId;
				setOpenDoc(null);
				return null;
			});
		},
		[manager]
	);

	React.useEffect(() => {
		let cancelled = false;
		// Branch: nothing selected.
		if (!selectedNoteId) {
			setOpenDoc(null);
			setOpenDocId(null);
			return;
		}

		(async () => {
			// Offline-first open: return as soon as IndexedDB-hydrated doc is ready.
			// WebSocket sync wiring is established by DocumentManager in parallel.
			const doc = await manager.getDocWithSync(selectedNoteId);
			if (cancelled) return;
			setOpenDoc(doc);
			setOpenDocId(selectedNoteId);
		})().catch((err) => {
			console.error('[CRDT] Failed to open note:', err);
		});

		return () => {
			cancelled = true;
		};
	}, [manager, selectedNoteId]);

	return (
		<div className={`test-harness-root${isFabOpen ? ' fab-open' : ''}`}>
			{isFabOpen ? (
				<button
					type="button"
					className="mobile-fab-backdrop"
					onClick={() => setIsFabOpen(false)}
					aria-label={t('app.closeQuickCreate')}
				/>
			) : null}
			<div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
				<aside className={`app-sidebar${isSidebarCollapsed ? ' is-collapsed' : ''}`}>
					<div className="app-sidebar-header">
						<button
							type="button"
							className="app-sidebar-toggle"
							onClick={() => setIsSidebarCollapsed((prev) => !prev)}
							aria-label={isSidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
							title={isSidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
						>
							☰
						</button>
						<span className="app-sidebar-logo" aria-hidden="true">
							FA
						</span>
					</div>

					<nav className="app-sidebar-nav" aria-label={t('grid.notes')}>
						{sidebarSections.map((entry) => (
							<button key={entry} type="button" className="app-sidebar-link">
								{entry}
							</button>
						))}
					</nav>
				</aside>

				<main className="app-main">
					<header className="app-topbar">
						<div className="app-topbar-search-wrap">
							<input
								type="search"
								className="app-topbar-search"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder={t('app.globalSearchPlaceholder')}
								aria-label={t('app.globalSearchPlaceholder')}
							/>
						</div>
						<div className="app-topbar-right">
							<div className="connection-indicator" aria-live="polite" title={`Connection: ${connection.state}`}>
								<span aria-hidden="true" className="connection-dot">
									{connection.state === 'connected' ? '🟢' : connection.state === 'connecting' ? '🟡' : '🔴'}
								</span>
							</div>
							<button
								type="button"
								className="avatar-trigger"
								onClick={() => setIsPreferencesOpen(true)}
								aria-label={t('prefs.title')}
								title={t('prefs.title')}
							>
								<span aria-hidden="true">👤</span>
							</button>
						</div>
					</header>

					<div className="top-actions">
						<button type="button" className="top-action-card" onClick={() => setEditorMode('text')}>
							{t('app.createNewNote')}
						</button>
						<button type="button" className="top-action-card" onClick={() => setEditorMode('checklist')}>
							{t('app.createNewChecklist')}
						</button>
					</div>

					<section className="editor-panel">
						{/* Branch: text editor open. */}
						{editorMode === 'text' ? <TextEditor onSave={onSaveText} onCancel={() => setEditorMode('none')} /> : null}
						{/* Branch: checklist editor open. */}
						{editorMode === 'checklist' ? (
							<ChecklistEditor onSave={onSaveChecklist} onCancel={() => setEditorMode('none')} />
						) : null}
					</section>

					<NoteGrid
						// Width behavior (desktop vs mobile, portrait/landscape) is centralized in NoteGrid.
						selectedNoteId={selectedNoteId}
						maxCardHeightPx={maxCardHeightPx}
						onSelectNote={(id) => {
							// Branch: selecting a note should close the create editor.
							setEditorMode('none');
							setSelectedNoteId(id);
						}}
					/>
				</main>
			</div>

			<div className={`mobile-fab-stack${isFabOpen ? ' is-open' : ''}`}>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						setEditorMode('text');
						setIsFabOpen(false);
					}}
				>
					{t('app.createNote')}
				</button>
				<button
					type="button"
					className="mobile-fab-action"
					onClick={() => {
						setEditorMode('checklist');
						setIsFabOpen(false);
					}}
				>
					{t('app.createChecklist')}
				</button>
			</div>

			<button
				type="button"
				className={`mobile-fab${isFabOpen ? ' is-open' : ''}`}
				onClick={() => setIsFabOpen((prev) => !prev)}
				aria-label={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
				title={isFabOpen ? t('app.closeQuickCreate') : t('app.openQuickCreate')}
			>
				<img src={fabIconSrc} alt="" aria-hidden="true" className="mobile-fab-icon" />
			</button>

			{/* Branch: selection exists but doc not yet loaded. */}
			{selectedNoteId && (!openDoc || openDocId !== selectedNoteId) ? <div>{t('app.loadingEditor')}</div> : null}
			{/* Branch: single active editor for the selected note. */}
			{selectedNoteId && openDoc && openDocId === selectedNoteId ? (
				<NoteEditor
					noteId={selectedNoteId}
					doc={openDoc}
					onClose={() => setSelectedNoteId(null)}
					onDelete={onDeleteSelectedNote}
				/>
			) : null}

			<PreferencesModal
				isOpen={isPreferencesOpen}
				onClose={() => setIsPreferencesOpen(false)}
				t={t}
				themeId={themeId}
				onThemeChange={setThemeId}
				language={locale}
				onLanguageChange={(next) => setLocale(next as LocaleCode)}
				themeOptions={themeOptions}
				languageOptions={languageOptions}
			/>
		</div>
	);
}
