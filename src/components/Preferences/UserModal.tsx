import React from 'react';
import Cropper from 'react-easy-crop';
import type { CropAreaPixels } from '../../core/avatarProfileImage';
import styles from './PreferencesModal.module.css';

export type UserModalProps = {
	isOpen: boolean;
	onClose: () => void;
	onBack: () => void;
	t: (key: string) => string;
	currentProfileImage: string | null;
	busy?: boolean;
	error?: string | null;
	onSave: (args: { imageUrl: string; crop: CropAreaPixels | null }) => Promise<void> | void;
};

export function UserModal(props: UserModalProps): React.JSX.Element | null {
	const fileInputRef = React.useRef<HTMLInputElement | null>(null);
	const [selectedImageUrl, setSelectedImageUrl] = React.useState<string | null>(null);
	const [selectedFileName, setSelectedFileName] = React.useState('');
	const [crop, setCrop] = React.useState({ x: 0, y: 0 });
	const [zoom, setZoom] = React.useState(1);
	const [areaPixels, setAreaPixels] = React.useState<CropAreaPixels | null>(null);

	React.useEffect(() => {
		if (props.isOpen) return;
		setSelectedImageUrl(null);
		setSelectedFileName('');
		setCrop({ x: 0, y: 0 });
		setZoom(1);
		setAreaPixels(null);
	}, [props.isOpen]);

	React.useEffect(() => {
		return () => {
			if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
		};
	}, [selectedImageUrl]);

	if (!props.isOpen) return null;

	const previewImageUrl = selectedImageUrl || props.currentProfileImage;

	return (
		<div className={styles.subOverlay} role="presentation" onClick={props.onClose}>
			<section className={styles.subModal} role="dialog" aria-modal="true" aria-label={props.t('prefs.user')} onClick={(event) => event.stopPropagation()}>
				<header className={styles.subHeader}>
					<h3 className={styles.subTitle}>{props.t('prefs.user')}</h3>
					<button type="button" className={styles.iconButton} onClick={props.onClose} aria-label={props.t('common.close')}>
						✕
					</button>
				</header>

				<div className={styles.subBody}>
					<div className={styles.userSection}>
						<div className={styles.userAvatarPreview}>
							{previewImageUrl ? (
								<img className={styles.userAvatarPreviewImage} src={previewImageUrl} alt="" />
							) : (
								<div className={styles.userAvatarPreviewFallback} aria-hidden="true">U</div>
							)}
						</div>
						<div className={styles.userCopy}>
							<p className={styles.userTitle}>{props.t('prefs.userAvatarTitle')}</p>
							<p className={styles.userDescription}>{props.t('prefs.userAvatarDescription')}</p>
						</div>
					</div>

					<label className={styles.field}>
						<span>{props.t('prefs.chooseProfilePhoto')}</span>
						<input
							ref={fileInputRef}
							type="file"
							className={styles.hiddenFileInput}
							accept="image/*"
							disabled={Boolean(props.busy)}
							onChange={(event) => {
								const file = event.currentTarget.files?.[0] ?? null;
								if (!file) return;
								if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
								const nextUrl = URL.createObjectURL(file);
								setSelectedImageUrl(nextUrl);
								setSelectedFileName(file.name);
								setCrop({ x: 0, y: 0 });
								setZoom(1);
								setAreaPixels(null);
								event.currentTarget.value = '';
							}}
						/>
						<div className={styles.filePickerRow}>
							<button type="button" className={styles.footerButton} onClick={() => fileInputRef.current?.click()} disabled={Boolean(props.busy)}>
								{props.t('common.chooseFiles')}
							</button>
							<div className={styles.filePickerSummary}>{selectedFileName || props.t('common.noFilesChosen')}</div>
						</div>
					</label>

					{selectedImageUrl ? (
						<div className={styles.userCropSection}>
							<div className={styles.userCropper}>
								<Cropper
									image={selectedImageUrl}
									crop={crop}
									zoom={zoom}
									aspect={1}
									onCropChange={setCrop}
									onZoomChange={setZoom}
									onCropComplete={(_area, nextAreaPixels) => {
										setAreaPixels({
											width: nextAreaPixels.width,
											height: nextAreaPixels.height,
											x: nextAreaPixels.x,
											y: nextAreaPixels.y,
										});
									}}
								/>
							</div>
							<label className={styles.userZoomField}>
								<span>{props.t('prefs.avatarZoom')}</span>
								<input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} disabled={Boolean(props.busy)} />
							</label>
						</div>
					) : null}

					{props.error ? <p className={styles.userError}>{props.error}</p> : null}

					<div className={styles.userActions}>
						<button type="button" className={styles.footerButton} onClick={props.onClose} disabled={Boolean(props.busy)}>
							{props.t('common.cancel')}
						</button>
						<button
							type="button"
							className={styles.footerButton}
							onClick={() => {
								if (!selectedImageUrl || props.busy) return;
								void props.onSave({ imageUrl: selectedImageUrl, crop: areaPixels });
							}}
							disabled={!selectedImageUrl || Boolean(props.busy)}
						>
							{props.busy ? props.t('common.loading') : props.t('common.save')}
						</button>
					</div>
				</div>

				<footer className={styles.subFooter}>
					<button type="button" className={styles.subBackButton} onClick={props.onBack} aria-label={props.t('common.back')}>
						← {props.t('common.back')}
					</button>
				</footer>
			</section>
		</div>
	);
}