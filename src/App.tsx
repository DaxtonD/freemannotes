import React from 'react';
import type * as Y from 'yjs';
import Cropper from 'react-easy-crop';
import fabIconDark from '../version.png';
import fabIconLight from '../version-light.png';
import { ChecklistEditor } from './components/Editors/ChecklistEditor';
import { NoteEditor } from './components/Editors/NoteEditor';
import { UserManagementModal } from './components/Admin/UserManagementModal';
import { PreferencesModal } from './components/Preferences/PreferencesModal';
import { TextEditor } from './components/Editors/TextEditor';
import { NoteGrid } from './components/NoteGrid/NoteGrid';
import { type ChecklistItem } from './core/bindings';
import { useDocumentManager } from './core/DocumentManagerContext';
import { type LocaleCode, useI18n } from './core/i18n';
import { initChecklistNoteDoc, initTextNoteDoc, makeNoteId } from './core/noteModel';
import { applyTheme, getStoredThemeId, isLightTheme, persistThemeId, THEMES, type ThemeId } from './core/theme';
import { useConnectionStatus } from './core/useConnectionStatus';
import { useIsCoarsePointer } from './core/useIsCoarsePointer';

type EditorMode = 'none' | 'text' | 'checklist';

// Cropper callback provides pixel coordinates in the *source image*.
// We store these so we can produce a deterministic 1:1 square avatar later.
type CropAreaPixels = { width: number; height: number; x: number; y: number };

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.addEventListener('load', () => resolve(img));
		img.addEventListener('error', () => reject(new Error('Failed to load image')));
		// Some browsers will taint the canvas if we draw cross-origin images
		// without CORS. Registration uses a local object URL, but we keep this here
		// because the helper is generic.
		img.crossOrigin = 'anonymous';
		img.src = src;
	});
}

async function getCroppedSquareBlob(imageSrc: string, crop: CropAreaPixels, sizePx: number): Promise<Blob> {
	// Converts a crop selection into a square PNG Blob.
	//
	// Why canvas:
	// - `react-easy-crop` gives us crop coordinates; canvas is the simplest way
	//   to apply those coordinates without additional dependencies.
	// - We upload a normalized image (small, square) to keep server work bounded
	//   and provide consistent avatar rendering.
	const image = await loadImage(imageSrc);
	const canvas = document.createElement('canvas');
	canvas.width = sizePx;
	canvas.height = sizePx;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas not supported');

	ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, sizePx, sizePx);

	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('Failed to encode image');
	return blob;
}

export function App(): React.JSX.Element {
	const manager = useDocumentManager();
	const connection = useConnectionStatus();
	const { t, locale, locales, setLocale } = useI18n();
	const [authStatus, setAuthStatus] = React.useState<'loading' | 'authed' | 'unauth'>('loading');
	const [authMode, setAuthMode] = React.useState<'login' | 'register'>('login');
	const [authEmail, setAuthEmail] = React.useState('');
	const [authName, setAuthName] = React.useState('');
	const [authPassword, setAuthPassword] = React.useState('');
	const [authError, setAuthError] = React.useState<string | null>(null);
	const [authBusy, setAuthBusy] = React.useState(false);
	const [authUserId, setAuthUserId] = React.useState<string | null>(null);
	const [authProfileImage, setAuthProfileImage] = React.useState<string | null>(null);
	const [registerAvatarUrl, setRegisterAvatarUrl] = React.useState<string | null>(null);
	const [registerAvatarCrop, setRegisterAvatarCrop] = React.useState({ x: 0, y: 0 });
	const [registerAvatarZoom, setRegisterAvatarZoom] = React.useState(1);
	const [registerAvatarAreaPixels, setRegisterAvatarAreaPixels] = React.useState<CropAreaPixels | null>(null);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
	// UI mode for the "new note" panel.
	const [editorMode, setEditorMode] = React.useState<EditorMode>('none');
	// Phase 10 preferences shell entry point opened from top-right avatar.
	const [isPreferencesOpen, setIsPreferencesOpen] = React.useState(false);
	const [isUserManagementOpen, setIsUserManagementOpen] = React.useState(false);
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

	React.useEffect(() => {
		// Session probe on app start:
		// - If authenticated, enable websocket sync.
		// - If not authenticated, keep the app in an auth gate and disable websocket
		//   sync (so we don't attempt to sync against a workspace we can't access).
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch('/api/auth/me', { credentials: 'include' });
				if (cancelled) return;

				const contentType = String(res.headers.get('content-type') || '').toLowerCase();
				if (!res.ok || !contentType.includes('application/json')) {
					setAuthStatus('unauth');
					manager.setWebsocketEnabled(false);
					return;
				}

				const body = await res.json().catch(() => null);
				const userId = body?.user?.id ? String(body.user.id) : '';
				const profileImage = body?.user?.profileImage ? String(body.user.profileImage) : null;
				const workspaceId = body?.workspaceId ? String(body.workspaceId) : '';
				if (!userId || !workspaceId) {
					setAuthStatus('unauth');
					setAuthUserId(null);
					setAuthProfileImage(null);
					manager.setWebsocketEnabled(false);
					return;
				}

				setAuthStatus('authed');
				setAuthUserId(userId);
				setAuthProfileImage(profileImage);
				manager.setWebsocketEnabled(true);
			} catch {
				if (cancelled) return;
				setAuthStatus('unauth');
				setAuthUserId(null);
				setAuthProfileImage(null);
				manager.setWebsocketEnabled(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [manager]);

	const signOut = React.useCallback(async () => {
		// Logout is best-effort: even if the request fails (offline), we clear local
		// auth state and disable websocket sync.
		try {
			await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
		} catch {
			// ignore
		}
		setAuthStatus('unauth');
		setAuthUserId(null);
		setAuthProfileImage(null);
		manager.setWebsocketEnabled(false);
		setIsUserManagementOpen(false);
		setIsPreferencesOpen(false);
	}, [manager]);

	React.useEffect(() => {
		// Switching away from registration should clear any staged avatar/crop state
		// so we don't accidentally upload a stale image on a later register attempt.
		if (authMode !== 'register') {
			setRegisterAvatarUrl(null);
			setRegisterAvatarAreaPixels(null);
		}
	}, [authMode]);

	React.useEffect(() => {
		// Prevent object URL leaks when the chosen avatar file changes or when the
		// component unmounts.
		return () => {
			if (registerAvatarUrl) URL.revokeObjectURL(registerAvatarUrl);
		};
	}, [registerAvatarUrl]);

	const submitAuth = React.useCallback(async () => {
		// Handles both login + register.
		// On successful registration, optionally uploads the cropped avatar as a
		// follow-up step. We then call /api/auth/me to populate the canonical user
		// fields (including profileImage) and ensure the UI updates immediately.
		if (authBusy) return;
		setAuthBusy(true);
		setAuthError(null);
		try {
			const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
			const payload: any = {
				email: authEmail,
				password: authPassword,
			};
			if (authMode === 'register') payload.name = authName;

			const res = await fetch(endpoint, {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (!res.ok) {
				let message = 'Authentication failed';
				try {
					const body = await res.json();
					if (body && typeof body.error === 'string') message = body.error;
				} catch {
					// ignore
				}
				setAuthError(message);
				setAuthStatus('unauth');
				manager.setWebsocketEnabled(false);
				return;
			}

			// Optional post-register avatar upload.
			// This is separate from the register endpoint so registration remains a
			// small JSON API and uploads are handled via multipart.
			if (authMode === 'register' && registerAvatarUrl && registerAvatarAreaPixels) {
				try {
					const blob = await getCroppedSquareBlob(registerAvatarUrl, registerAvatarAreaPixels, 256);
					const form = new FormData();
					form.append('file', blob, 'avatar.png');
					const uploadRes = await fetch('/api/user/profile-image', {
						method: 'POST',
						credentials: 'include',
						body: form,
					});
					// Fetch does not throw on non-2xx; enforce it explicitly.
					if (!uploadRes.ok) throw new Error('Upload failed');
					const uploadBody = await uploadRes.json().catch(() => null);
					const profileImage = uploadBody?.profileImage ? String(uploadBody.profileImage) : null;
					if (profileImage) setAuthProfileImage(profileImage);
				} catch {
					setAuthError('Account created, but profile photo upload failed');
				}
			}

			// Re-fetch /me so we always sync to the server's truth. This keeps behavior
			// consistent if server-side bootstrap logic updates role/workspace.
			try {
				const meRes = await fetch('/api/auth/me', { credentials: 'include' });
				const contentType = String(meRes.headers.get('content-type') || '').toLowerCase();
				if (meRes.ok && contentType.includes('application/json')) {
					const meBody = await meRes.json().catch(() => null);
					const userId = meBody?.user?.id ? String(meBody.user.id) : null;
					const profileImage = meBody?.user?.profileImage ? String(meBody.user.profileImage) : null;
					setAuthUserId(userId);
					setAuthProfileImage(profileImage);
				}
			} catch {
				// ignore
			}

			setAuthStatus('authed');
			manager.setWebsocketEnabled(true);
		} catch {
			setAuthError('Authentication failed');
			setAuthStatus('unauth');
			manager.setWebsocketEnabled(false);
		} finally {
			setAuthBusy(false);
		}
	}, [authBusy, authEmail, authMode, authName, authPassword, manager, registerAvatarAreaPixels, registerAvatarUrl]);

	const authGateView = (
		<div className="auth-shell">
			<div className="auth-card">
				<div className="auth-title">FreemanNotes</div>
				<div className="auth-subtitle">
					{authStatus === 'loading' ? 'Checking session…' : 'Sign in to enable sync'}
				</div>
				<div className="auth-mode-row">
					<button
						type="button"
						className={authMode === 'login' ? 'auth-mode is-active' : 'auth-mode'}
						onClick={() => {
							setAuthMode('login');
							setAuthError(null);
						}}
						disabled={authBusy || authStatus === 'loading'}
					>
						Login
					</button>
					<button
						type="button"
						className={authMode === 'register' ? 'auth-mode is-active' : 'auth-mode'}
						onClick={() => {
							setAuthMode('register');
							setAuthError(null);
						}}
						disabled={authBusy || authStatus === 'loading'}
					>
						Register
					</button>
				</div>
				<form
					className="auth-form"
					onSubmit={(e) => {
						e.preventDefault();
						void submitAuth();
					}}
				>
					<label className="auth-label">
						Email
						<input
							type="email"
							autoComplete="email"
							value={authEmail}
							onChange={(e) => setAuthEmail(e.target.value)}
							disabled={authBusy || authStatus === 'loading'}
							required
						/>
					</label>
					{authMode === 'register' ? (
						<label className="auth-label">
							Name
							<input
								type="text"
								autoComplete="name"
								value={authName}
								onChange={(e) => setAuthName(e.target.value)}
								disabled={authBusy || authStatus === 'loading'}
								required
							/>
						</label>
					) : null}
					{authMode === 'register' ? (
						<div className="auth-avatar">
							<label className="auth-label">
								Profile photo (optional)
								<input
									type="file"
									accept="image/*"
									disabled={authBusy || authStatus === 'loading'}
									onChange={(e) => {
										const file = e.currentTarget.files && e.currentTarget.files[0] ? e.currentTarget.files[0] : null;
										if (!file) {
											setRegisterAvatarUrl(null);
											setRegisterAvatarAreaPixels(null);
											return;
										}
										const url = URL.createObjectURL(file);
										setRegisterAvatarUrl(url);
										setRegisterAvatarZoom(1);
										setRegisterAvatarCrop({ x: 0, y: 0 });
										setRegisterAvatarAreaPixels(null);
									}}
								/>
							</label>
							{registerAvatarUrl ? (
								<div className="auth-avatar-crop">
									<div className="auth-avatar-cropper">
										<Cropper
											image={registerAvatarUrl}
											crop={registerAvatarCrop}
											zoom={registerAvatarZoom}
											aspect={1}
											onCropChange={setRegisterAvatarCrop}
											onZoomChange={setRegisterAvatarZoom}
											onCropComplete={(_area, areaPixels) => {
												setRegisterAvatarAreaPixels({
													width: areaPixels.width,
													height: areaPixels.height,
													x: areaPixels.x,
													y: areaPixels.y,
												});
											}}
										/>
									</div>
									<label className="auth-avatar-zoom">
										Zoom
										<input
											type="range"
											min={1}
											max={3}
											step={0.1}
											value={registerAvatarZoom}
											onChange={(e) => setRegisterAvatarZoom(Number(e.target.value))}
											disabled={authBusy || authStatus === 'loading'}
										/>
									</label>
								</div>
							) : null}
						</div>
					) : null}
					<label className="auth-label">
						Password
						<input
							type="password"
							autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
							value={authPassword}
							onChange={(e) => setAuthPassword(e.target.value)}
							disabled={authBusy || authStatus === 'loading'}
							required
						/>
					</label>
					{authError ? <div className="auth-error">{authError}</div> : null}
					<button type="submit" disabled={authBusy || authStatus === 'loading'}>
						{authBusy ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Sign in'}
					</button>
				</form>
				<div className="auth-hint">Sync is disabled until you sign in.</div>
			</div>
		</div>
	);

	const themeOptions = React.useMemo(() => {
		return THEMES.map((theme) => ({ id: theme.id, label: t(theme.labelKey) }));
	}, [t]);

	const languageOptions = React.useMemo(() => {
		return locales.map((entry) => ({ code: entry.code, label: entry.label }));
	}, [locales]);

	const fabIconSrc = React.useMemo(() => {
		return isLightTheme(themeId) ? fabIconDark : fabIconLight;
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

	if (authStatus !== 'authed') {
		return authGateView;
	}

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
								{authProfileImage ? <img className="avatar-img" src={authProfileImage} alt="" /> : <span aria-hidden="true">👤</span>}
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
				onUserManagement={() => {
					setIsPreferencesOpen(false);
					setIsUserManagementOpen(true);
				}}
				onSignOut={() => void signOut()}
			/>

			<UserManagementModal
				isOpen={isUserManagementOpen}
				onClose={() => setIsUserManagementOpen(false)}
				currentUserId={authUserId}
			/>
		</div>
	);
}
