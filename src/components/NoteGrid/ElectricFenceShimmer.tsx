/**
 * ElectricFenceShimmer — note card loading overlay.
 *
 * Behaviour is controlled by the build-time env var VITE_NOTE_CARD_EFFECT:
 *
 *   0 (default / unset) — simple CSS gradient sweep shimmer.
 *                         Low overhead; no extra assets required.
 *   1                   — HL2 Combine electric-fence crackle SVG overlay.
 *                         SVG assets: public/icons/crackle.svg (dark) and
 *                         public/icons/crackle-light.svg (light).
 *                         Regenerate with: node scripts/generate-crackle-svg.mjs
 */

import React from 'react';
import { isLightTheme, type ThemeId } from '../../core/theme';
import styles from './NoteGrid.module.css';

const USE_HL2_EFFECT = import.meta.env.VITE_NOTE_CARD_EFFECT === '1';

type Props = {
	/** Controls CSS opacity (1 while loading, fades to 0 when docs are ready). */
	visible: boolean;
	/** Current app theme — selects the dark or light SVG variant (HL2 mode only). */
	themeId: ThemeId;
};

/**
 * Drop-in shimmer overlay for skeleton/hydrating note cards.
 * Fades out smoothly when `visible` becomes false.
 */
export const ElectricFenceShimmer = React.memo(
	function ElectricFenceShimmer({ visible, themeId }: Props): React.JSX.Element {
		if (!USE_HL2_EFFECT) {
			// Simple CSS shimmer — just a translucent gradient sweep.
			return (
				<div
					aria-hidden="true"
					className={`${styles.shimmerOverlay}${visible ? ` ${styles.shimmerVisible}` : ''}`}
				/>
			);
		}

		// HL2 electric-fence SVG overlay.
		const isLight = isLightTheme(themeId);
		const src = isLight ? '/icons/crackle-light.svg' : '/icons/crackle.svg';
		const outerGlow = isLight
			? '0 0 10px rgba(0, 120, 185, 0.42), 0 0 3px rgba(0, 145, 210, 0.6)'
			: '0 0 16px rgba(0, 210, 255, 0.55), 0 0 5px rgba(0, 240, 255, 0.72)';

		return (
			<div
				aria-hidden="true"
				style={{
					position: 'absolute',
					inset: 0,
					zIndex: 10,
					borderRadius: 'var(--radius-sm)',
					overflow: 'hidden',
					pointerEvents: 'none',
					opacity: visible ? 1 : 0,
					transition: 'opacity 0.45s ease-out',
					boxShadow: outerGlow,
				}}
			>
				<img
					src={src}
					alt=""
					aria-hidden="true"
					style={{
						display: 'block',
						width: '100%',
						height: '100%',
						objectFit: 'cover',
						objectPosition: 'center center',
					}}
				/>
			</div>
		);
	},
);