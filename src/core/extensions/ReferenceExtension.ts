import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { Suggestion, type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';
import { v4 as uuidv4 } from 'uuid';
import { Reference } from './Reference';
import type { ReferenceGroup, ReferenceResult } from '../references/ReferenceProvider';
import { searchReferenceProviders } from '../references/ReferenceProvider';
import ReferenceDropdown, { type RolePickState } from '../../components/References/ReferenceDropdown';

export const ReferenceSuggestionKey = new PluginKey('referenceSuggestion');

type SuggestionItem = ReferenceGroup;
type SelectedItem = ReferenceResult;

// The NoteEditor floating toolbar uses:
//   top: ${keyboard.visibleBottom}px; transform: translateY(-100%)
// visibleBottom = vv.offsetTop + vv.height (same formula as useKeyboardHeight).
// Toolbar height ≈ 56 px (4px padding × 2 + 4px format-bar padding × 2 + 36px buttons).
// We add 8px breathing room → 64px reserved when computing space below.
const TOOLBAR_RESERVE_PX = 64;

/**
 * Copies note-editor CSS custom properties from the editor DOM to the dropdown
 * container so the dropdown inherits the note's custom background/text color.
 *
 * NoteEditor.tsx applies --note-editor-surface/text/muted/border on the editor
 * shell (editorColorStyle). These cascade to editor.view.dom but NOT to a
 * container appended to document.body, so we copy them manually.
 */
function applyNoteColorsToContainer(container: HTMLElement, editorDom: Element): void {
	try {
		const cs = window.getComputedStyle(editorDom);
		const surface = cs.getPropertyValue('--note-editor-surface').trim();
		const text    = cs.getPropertyValue('--note-editor-text').trim();
		const muted   = cs.getPropertyValue('--note-editor-muted').trim();
		const border  = cs.getPropertyValue('--note-editor-border').trim();
		if (surface) container.style.setProperty('--note-editor-surface', surface);
		if (text)    container.style.setProperty('--note-editor-text', text);
		if (muted)   container.style.setProperty('--note-editor-muted', muted);
		if (border)  container.style.setProperty('--note-editor-border', border);
	} catch {
		// Non-critical — default CSS vars are used as fallback
	}
}

/**
 * Returns how many CSS pixels the keyboard bottom edge is from the top of the
 * CSS viewport. When the soft keyboard is closed this equals window.innerHeight.
 * Uses the same formula as useKeyboardHeight.ts.
 */
function getKeyboardVisibleBottom(): number {
	const vv = window.visualViewport;
	if (!vv) return window.innerHeight;
	return Math.round(vv.offsetTop + vv.height);
}

/**
 * Extends the Reference atom node with an '@' Suggestion plugin.
 *
 * Key design decisions to preserve mobile UX:
 *
 * 1. Container lifecycle: created in addProseMirrorPlugins() at EDITOR MOUNT time,
 *    kept hidden as display:none. This is critical — appending a position:fixed
 *    element while the virtual keyboard is open collapses the iOS Safari / Android
 *    keyboard. Pre-inserting at editor mount (before the user types '@') prevents
 *    any DOM mutation at suggestion-activation time.
 *
 * 2. Positioning: pick the direction (above or below cursor) with the most room.
 *    When the keyboard is open, "below" space is capped by the floating toolbar
 *    that sits at top:${visibleBottom}px (TOOLBAR_RESERVE_PX accounts for it).
 *    This keeps the dropdown visible without covering the toolbar.
 *
 * 3. Note colors: CSS vars from the editor DOM are copied to the container on each
 *    onStart so the dropdown matches the note's custom color scheme.
 */
export const ReferenceExtension = Reference.extend({
	addProseMirrorPlugins() {
		const editor = (this as unknown as { editor: Editor }).editor;

		// ── Container created at editor mount, NOT at first suggestion activation ──
		// iOS Safari and Android Chrome collapse the soft keyboard when a
		// position:fixed element is appended to the body mid-session. Pre-inserting
		// the hidden container here prevents DOM mutation when '@' fires later.
		const container = document.createElement('div');
		container.style.cssText = 'position:fixed;z-index:10000;display:none;pointer-events:none;';
		container.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.on('destroy', () => {
			root.unmount();
			container.remove();
		});

		// Shared suggestion state (persists across onStart/onUpdate/onExit cycles)
		let groups: SuggestionItem[]                              = [];
		let selectedIndex                                          = 0;
		let latestCommand: ((item: SelectedItem) => void) | null  = null;
		let latestClientRect: (() => DOMRect | null) | null       = null;
		let currentMaxHeight                                       = 220;
		let vpResizeHandler: (() => void) | null                  = null;
		let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;

		// Role picker state — set when user selects a user-type item
		let rolePickState: RolePickState | null                    = null;

		const confirmWithRole = (roleIndex: 0 | 1) => {
			if (!rolePickState) return;
			const result: SelectedItem = { ...rolePickState.result, editRole: roleIndex === 0 ? 'VIEWER' : 'EDITOR' };
			rolePickState = null;
			latestCommand?.(result);
		};

		const rerender = () => {
			root.render(
				React.createElement(ReferenceDropdown, {
					groups,
					selectedIndex,
					maxHeight: currentMaxHeight,
					rolePick: rolePickState,
					onRoleConfirm: confirmWithRole,
					onSelect: (result: SelectedItem) => {
						if (result.type === 'user') {
							// Intercept user selections and show the role picker
							rolePickState = { result, roleIndex: 1 }; // default: EDITOR
							rerender();
						} else {
							latestCommand?.(result);
						}
					},
				})
			);
		};

		const reposition = () => {
			if (!latestClientRect) return;
			const rect = latestClientRect();
			if (!rect) return;

			const cssVh          = window.innerHeight;
			const visibleBottom  = getKeyboardVisibleBottom();
			const vw             = window.innerWidth;

			// Space below cursor before the toolbar / keyboard
			const spaceBelow = Math.max(0, visibleBottom - rect.bottom - TOOLBAR_RESERVE_PX - 4);
			// Space above cursor
			const spaceAbove = Math.max(0, rect.top - 8);

			const left = Math.max(4, Math.min(rect.left, vw - 336));
			container.style.left = `${left}px`;

			if (spaceBelow >= spaceAbove) {
				// More (or equal) room below cursor — open downward
				currentMaxHeight       = Math.max(50, Math.min(spaceBelow, 360));
				container.style.top    = `${rect.bottom + 4}px`;
				container.style.bottom = 'auto';
			} else {
				// More room above cursor — open upward
				// Use cssVh for bottom offset (position:fixed is relative to CSS viewport)
				currentMaxHeight       = Math.max(50, Math.min(spaceAbove, 360));
				container.style.bottom = `${cssVh - rect.top + 4}px`;
				container.style.top    = 'auto';
			}
		};

		return [
			Suggestion<SuggestionItem, SelectedItem>({
				pluginKey: ReferenceSuggestionKey,
				editor,
				char: '@',
				allowSpaces: false,
				startOfLine: false,

				items: async ({ query }: { query: string; editor: Editor; signal: AbortSignal }): Promise<SuggestionItem[]> => {
					return searchReferenceProviders(query);
				},

				command: ({
					editor: cmdEditor,
					range,
					props: result,
				}: {
					editor: Editor;
					range: { from: number; to: number };
					props: SelectedItem;
				}) => {
					(cmdEditor as any)
						.chain()
						.focus()
						.deleteRange(range)
						.insertContent({
							type: 'reference',
							attrs: {
								type: result.type,
								id: result.id,
								label: result.label,
								nodeId: uuidv4(),
								editRole: result.editRole ?? 'EDITOR',
							},
						})
						.insertContent(' ')
						.run();

					// When @mentioning a user inside a bullet or numbered list item,
					// convert it to a task list item (taskify). This mirrors the UX
					// described in the product spec: assigning via @mention creates a task.
					if (result.type === 'user') {
						const { $from } = cmdEditor.state.selection;
						for (let d = $from.depth; d >= 0; d--) {
							const name = $from.node(d).type.name;
							if (name === 'taskItem') break; // already a task — no conversion needed
							if (name === 'listItem') {
								// toggleTaskList converts the current bullet/numbered item to a taskItem.
								(cmdEditor as any).commands.toggleTaskList();
								break;
							}
						}
					}
				},

				render: () => {
					// Container is already in the DOM — render() only wires the lifecycle.
					return {
						onStart(props: SuggestionProps<SuggestionItem, SelectedItem>) {
							latestCommand    = props.command;
							latestClientRect = props.clientRect ?? null;
							groups           = props.items ?? [];
							selectedIndex    = 0;

							// Re-read note colors each time (note color may have changed)
							applyNoteColorsToContainer(container, editor.view.dom);
							container.style.display       = 'block';
							container.style.pointerEvents = 'auto';
							reposition();
							rerender();

							// Reposition when the keyboard opens/closes (visualViewport
							// resize). Handles the case where the user places the caret on
							// an existing '@' and THEN the keyboard appears.
							if (window.visualViewport) {
								vpResizeHandler = () => { reposition(); rerender(); };
								window.visualViewport.addEventListener('resize', vpResizeHandler);
							}

							// Close when the user taps/clicks outside both the editor and
							// the dropdown. Handles mobile taps that don't reliably blur
							// the editor, and desktop clicks away from the editor shell.
							outsidePointerHandler = (e: PointerEvent) => {
								const target = e.target as Node;
								if (!container.contains(target) && !editor.view.dom.contains(target)) {
									editor.commands.blur();
								}
							};
							document.addEventListener('pointerdown', outsidePointerHandler, { capture: true });
						},

						onUpdate(props: SuggestionProps<SuggestionItem, SelectedItem>) {
							latestCommand    = props.command;
							latestClientRect = props.clientRect ?? null;
							groups           = props.items ?? [];
							selectedIndex    = 0;
							reposition();
							rerender();
						},

						onKeyDown({ event }: SuggestionKeyDownProps): boolean {
							// When role picker is active, handle its own key navigation
							if (rolePickState) {
								if (event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
									rolePickState = { ...rolePickState, roleIndex: 0 };
									rerender();
									return true;
								}
								if (event.key === 'ArrowRight' || (event.key === 'Tab' && !event.shiftKey)) {
									rolePickState = { ...rolePickState, roleIndex: 1 };
									rerender();
									return true;
								}
								if (event.key === 'Enter') {
									confirmWithRole(rolePickState.roleIndex);
									return true;
								}
								if (event.key === 'Escape') {
									rolePickState = null;
									rerender();
									return true;
								}
								// Consume all other keys while role picker is open
								return true;
							}

							const allItems = groups.flatMap((g) => g.results);
							if (!allItems.length) return false;

							if (event.key === 'ArrowDown') {
								selectedIndex = (selectedIndex + 1) % allItems.length;
								rerender();
								return true;
							}
							if (event.key === 'ArrowUp') {
								selectedIndex = (selectedIndex - 1 + allItems.length) % allItems.length;
								rerender();
								return true;
							}
							if (event.key === 'Enter') {
								const selected = allItems[selectedIndex];
								if (!selected) return true;
								if (selected.type === 'user') {
									// Enter on a user: open role picker (default EDITOR)
									rolePickState = { result: selected, roleIndex: 1 };
									rerender();
								} else {
									latestCommand?.(selected);
								}
								return true;
							}
							return false;
						},

						onExit() {
							if (vpResizeHandler && window.visualViewport) {
								window.visualViewport.removeEventListener('resize', vpResizeHandler);
								vpResizeHandler = null;
							}
							if (outsidePointerHandler) {
								document.removeEventListener('pointerdown', outsidePointerHandler, { capture: true });
								outsidePointerHandler = null;
							}
							rolePickState = null;
							container.style.display       = 'none';
							container.style.pointerEvents = 'none';
							root.render(null);
							latestCommand    = null;
							latestClientRect = null;
						},
					};
				},
			}),
		];
	},
});
