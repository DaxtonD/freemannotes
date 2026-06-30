/**
 * Inline chip rendered by ReactNodeViewRenderer for Reference atom nodes.
 *
 * User chips: avatar image (captured at insertion) → colored initials fallback.
 * Note chips: type-specific FontAwesome icon + title.
 *
 * data-reference / data-type / data-id are forwarded on the NodeViewWrapper so
 * RichTextEditor's handleReferenceClick can find the node via .closest() and
 * open the referenced note.
 */
import React from 'react';
import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faNoteSticky, faListCheck, faPencil, faBell, faLock } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { useIsNoteDenied } from '../../core/references/noteAccessCache';

function noteTypeIcon(noteType?: string | null): IconDefinition {
	switch (noteType) {
		case 'checklist': return faListCheck;
		case 'drawing':   return faPencil;
		case 'reminder':  return faBell;
		default:          return faNoteSticky;
	}
}

// Deterministic accent color for a user's initials fallback, derived from their id.
const AVATAR_PALETTE = ['#4a9eff', '#f47b5f', '#54c77d', '#a07af4', '#f4bb54', '#e05fd4'];

function avatarColor(seed: string): string {
	let h = 0;
	for (let i = 0; i < seed.length; i++) {
		h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
	}
	return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function initials(label: string): string {
	const parts = label.trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ReferenceChip({ node }: NodeViewProps) {
	const { type, label, noteType, id, avatarUrl } = node.attrs as {
		type: string;
		label: string;
		noteType?: string | null;
		id: string;
		avatarUrl?: string | null;
	};

	// Empty string never matches a real noteId, so user chips are always non-denied.
	const isDenied = useIsNoteDenied(type === 'note' ? id : '');

	if (type === 'user') {
		const bg = avatarColor(id || label);
		return (
			<NodeViewWrapper
				as="span"
				className="fn-reference-chip fn-reference-chip--user"
				data-reference="true"
				data-type="user"
				data-id={id}
				contentEditable={false}
			>
				{avatarUrl ? (
					<img
						src={avatarUrl}
						className="fn-reference-chip__avatar-img"
						alt=""
						aria-hidden="true"
					/>
				) : (
					<span
						className="fn-reference-chip__avatar"
						style={{ background: bg } as React.CSSProperties}
						aria-hidden="true"
					>
						{initials(label)}
					</span>
				)}
				<span className="fn-reference-chip__label">{label}</span>
			</NodeViewWrapper>
		);
	}

	return (
		<NodeViewWrapper
			as="span"
			className={`fn-reference-chip fn-reference-chip--note${isDenied ? ' fn-reference-chip--denied' : ''}`}
			data-reference="true"
			data-type="note"
			data-id={id}
			data-note-type={noteType ?? 'note'}
			data-access={isDenied ? 'denied' : undefined}
			title={isDenied ? "You don't have access to this note" : undefined}
			contentEditable={false}
		>
			<span className="fn-reference-chip__icon" aria-hidden="true">
				<FontAwesomeIcon icon={isDenied ? faLock : noteTypeIcon(noteType)} />
			</span>
			<span className="fn-reference-chip__label">{label}</span>
		</NodeViewWrapper>
	);
}
