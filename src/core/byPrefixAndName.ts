import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { faBan, faCheck, faFloppyDisk } from '@fortawesome/free-solid-svg-icons';
import { faCircleXmark } from '@fortawesome/free-regular-svg-icons';

// Central icon registry used by editor dock actions.
//
// Why this helper exists instead of importing icons directly in every editor:
// - Keeps icon choice consistent across Text/Checklist/Note editors.
// - Makes future icon swaps mechanical (single-file edit).
// - Prevents accidental divergence where the same action uses different glyphs.
//
// Branch notes:
// - `fas` bucket is for active/primary action glyphs (save/cancel/confirm).
// - `far` bucket intentionally holds a softer close icon variant so the default
//   “close” state reads as less destructive than solid danger/confirm actions.
export const byPrefixAndName: {
	fas: Record<string, IconDefinition>;
	far: Record<string, IconDefinition>;
} = {
	fas: {
		'floppy-disk': faFloppyDisk,
		ban: faBan,
		check: faCheck,
	},
	far: {
		xmark: faCircleXmark,
	},
};
