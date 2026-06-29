import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faNoteSticky, faListCheck, faPencil, faBell, faEye, faPenToSquare } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { ReferenceGroup, ReferenceResult } from '../../core/references/ReferenceProvider';
import styles from './ReferenceDropdown.module.css';

function noteIcon(noteType?: string): IconDefinition {
	switch (noteType) {
		case 'checklist': return faListCheck;
		case 'drawing':   return faPencil;
		case 'reminder':  return faBell;
		default:          return faNoteSticky;
	}
}

export interface RolePickState {
	result: ReferenceResult;
	roleIndex: 0 | 1; // 0 = VIEWER, 1 = EDITOR
}

interface Props {
	groups: ReferenceGroup[];
	selectedIndex: number;
	onSelect: (result: ReferenceResult) => void;
	maxHeight?: number;
	rolePick?: RolePickState | null;
	onRoleConfirm?: (idx: 0 | 1) => void;
}

export default function ReferenceDropdown({ groups, selectedIndex, onSelect, maxHeight, rolePick, onRoleConfirm }: Props) {
	const dropdownStyle = maxHeight ? { maxHeight: `${maxHeight}px` } : undefined;

	if (rolePick) {
		const { result, roleIndex } = rolePick;
		return (
			<div className={styles.dropdown} style={dropdownStyle}>
				<div className={styles.rolePickHeader}>
					{result.avatarUrl ? (
						<img src={result.avatarUrl} className={styles.avatar} alt="" />
					) : (
						<span className={styles.iconWrap}>
							<FontAwesomeIcon icon={faUser} />
						</span>
					)}
					<span className={styles.rolePickName}>{result.label}</span>
				</div>
				<div className={styles.rolePickButtons}>
					<button
						type="button"
						className={`${styles.roleBtn}${roleIndex === 0 ? ` ${styles.roleBtnActive}` : ''}`}
						onMouseDown={(e) => { e.preventDefault(); onRoleConfirm?.(0); }}
					>
						<FontAwesomeIcon icon={faEye} />
						View
					</button>
					<button
						type="button"
						className={`${styles.roleBtn}${roleIndex === 1 ? ` ${styles.roleBtnActive}` : ''}`}
						onMouseDown={(e) => { e.preventDefault(); onRoleConfirm?.(1); }}
					>
						<FontAwesomeIcon icon={faPenToSquare} />
						Edit
					</button>
				</div>
			</div>
		);
	}

	let absoluteIndex = 0;

	if (groups.length === 0) {
		return (
			<div className={styles.dropdown} style={dropdownStyle}>
				<div className={styles.empty}>No results</div>
			</div>
		);
	}

	return (
		<div className={styles.dropdown} style={dropdownStyle}>
			{groups.map((group) => (
				<div key={group.type} className={styles.group}>
					<div className={styles.groupLabel}>{group.groupLabel}</div>
					{group.results.map((result) => {
						const idx = absoluteIndex++;
						return (
							<button
								key={result.id}
								type="button"
								className={`${styles.item}${idx === selectedIndex ? ` ${styles.selected}` : ''}`}
								onMouseDown={(e) => {
									e.preventDefault();
									onSelect(result);
								}}
							>
								{result.type === 'user' && result.avatarUrl ? (
									<img src={result.avatarUrl} className={styles.avatar} alt="" />
								) : (
									<span className={styles.iconWrap}>
										<FontAwesomeIcon icon={result.type === 'user' ? faUser : noteIcon(result.noteType)} />
									</span>
								)}
								<span className={styles.label}>{result.label}</span>
								{result.sublabel && (
									<span className={styles.sublabel}>{result.sublabel}</span>
								)}
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}
