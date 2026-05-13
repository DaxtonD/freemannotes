import React from 'react';
import { createPortal } from 'react-dom';
import { DRAWING_BACKGROUND_PRESETS } from '../../core/drawingBackground';
import modalStyles from '../NoteCard/NoteColorPickerModal.module.css';

type DrawingCanvasBackgroundModalProps = {
	isOpen: boolean;
	selectedColor: string;
	onClose: () => void;
	onSelect: (color: string) => void;
};

export function DrawingCanvasBackgroundModal(props: DrawingCanvasBackgroundModalProps): React.JSX.Element | null {
	React.useEffect(() => {
		if (!props.isOpen || typeof window === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') props.onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [props.isOpen, props.onClose]);

	if (!props.isOpen || typeof document === 'undefined') return null;

	return createPortal(
		<div className={modalStyles.overlay} role="presentation" onClick={props.onClose}>
			<section
				className={modalStyles.modal}
				role="dialog"
				aria-modal="true"
				aria-label="Canvas background"
				onClick={(event) => event.stopPropagation()}
			>
				<header className={modalStyles.header}>
					<h3 className={modalStyles.title}>Canvas background</h3>
					<button type="button" className={modalStyles.closeButton} onClick={props.onClose} aria-label="Close canvas background picker">
						✕
					</button>
				</header>
				<div className={modalStyles.grid} role="list" aria-label="Canvas background options">
					{DRAWING_BACKGROUND_PRESETS.map((preset) => {
						const isActive = props.selectedColor.toLowerCase() === preset.color.toLowerCase();
						return (
							<button
								key={preset.id}
								type="button"
								role="listitem"
								className={`${modalStyles.option}${isActive ? ` ${modalStyles.optionActive}` : ''}`}
								onClick={() => props.onSelect(preset.color)}
							>
								<span
									className={modalStyles.swatch}
									aria-hidden="true"
									style={{
										background: preset.color,
										borderColor: 'color-mix(in srgb, var(--color-border) 72%, transparent)',
									}}
								/>
								<span className={modalStyles.label}>{preset.label}</span>
							</button>
						);
					})}
				</div>
			</section>
		</div>,
		document.body
	);
}