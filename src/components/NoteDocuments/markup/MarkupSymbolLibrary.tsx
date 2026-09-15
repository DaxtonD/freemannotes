import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { SYMBOL_CATEGORIES, SYMBOLS, SymbolGlyph, type SymbolCategory, type SymbolDefinition } from './markupSymbols';
import styles from './Markup.module.css';

// The symbol library panel: search, category chips, and a grid of symbols grouped by category.
// It floats over the page next to the tool bar and gets out of the way as soon as a symbol is
// picked; the tool bar keeps the recent ones for quick switching.

type MarkupSymbolLibraryProps = {
	placement: 'top' | 'bottom';
	selectedId: string;
	isCoarsePointer: boolean;
	t: (key: string) => string;
	onPick: (id: string) => void;
	onClose: () => void;
};

// Remembered while the app is open, so reopening the library lands where you were browsing.
let lastCategory: SymbolCategory | 'all' = 'all';

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function MarkupSymbolLibrary(props: MarkupSymbolLibraryProps): React.JSX.Element {
	const { t, onClose } = props;
	const [query, setQuery] = React.useState('');
	const [category, setCategory] = React.useState<SymbolCategory | 'all'>(lastCategory);
	const rootRef = React.useRef<HTMLDivElement | null>(null);
	const searchRef = React.useRef<HTMLInputElement | null>(null);

	React.useEffect(() => {
		// A phone keyboard would cover half the library; only desktop jumps straight into search.
		if (!props.isCoarsePointer) searchRef.current?.focus({ preventScroll: true });
	}, [props.isCoarsePointer]);

	// A press anywhere outside closes it (the button that opened it handles its own toggle).
	React.useEffect(() => {
		const onPointerDown = (event: PointerEvent): void => {
			const target = event.target as Element | null;
			if (!target || rootRef.current?.contains(target) || target.closest?.('[data-symbol-library-toggle]')) return;
			onClose();
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		return () => document.removeEventListener('pointerdown', onPointerDown, true);
	}, [onClose]);

	const chooseCategory = (next: SymbolCategory | 'all'): void => {
		lastCategory = next;
		setCategory(next);
	};

	const words = fold(query).split(/\s+/).filter(Boolean);
	const searching = words.length > 0;
	const matches = SYMBOLS.filter((definition) => {
		if (!searching) return category === 'all' || definition.category === category;
		const haystack = fold(`${t(definition.nameKey)} ${definition.tags}`);
		return words.every((word) => haystack.includes(word));
	});

	const tile = (definition: SymbolDefinition): React.JSX.Element => {
		const name = t(definition.nameKey);
		const active = definition.id === props.selectedId;
		return (
			<button
				key={definition.id}
				type="button"
				className={`${styles.libraryTile}${active ? ` ${styles.libraryTileActive}` : ''}`}
				onClick={() => props.onPick(definition.id)}
				aria-pressed={active}
				title={name}
			>
				<SymbolGlyph definition={definition} size={40} />
				<span className={styles.libraryTileName}>{name}</span>
			</button>
		);
	};

	return (
		<div
			ref={rootRef}
			className={`${styles.library} ${props.placement === 'bottom' ? styles.libraryBottom : styles.libraryTop}`}
			role="dialog"
			aria-label={t('documents.markupSymbolLibrary')}
			// The tool bar swallows mouse presses to keep focus in a text note; the library needs
			// them for its search box and scrollbar.
			onMouseDown={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<div className={styles.libraryHeader}>
				<div className={styles.librarySearchField}>
					<FontAwesomeIcon icon={faMagnifyingGlass} className={styles.librarySearchIcon} />
					<input
						ref={searchRef}
						className={styles.librarySearch}
						type="search"
						value={query}
						placeholder={t('documents.markupSymbolSearch')}
						aria-label={t('documents.markupSymbolSearch')}
						autoComplete="off"
						enterKeyHint="search"
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
				<button type="button" className={styles.tool} onClick={onClose} aria-label={t('documents.markupSymbolClose')} title={t('documents.markupSymbolClose')}>
					<FontAwesomeIcon icon={faXmark} />
				</button>
			</div>
			{!searching ? (
				<div className={styles.libraryCategories} role="tablist">
					{[{ id: 'all' as const, labelKey: 'documents.markupSymbolAll' }, ...SYMBOL_CATEGORIES].map((entry) => (
						<button
							key={entry.id}
							type="button"
							role="tab"
							aria-selected={category === entry.id}
							className={`${styles.libraryCategory}${category === entry.id ? ` ${styles.libraryCategoryActive}` : ''}`}
							onClick={() => chooseCategory(entry.id)}
						>
							{t(entry.labelKey)}
						</button>
					))}
				</div>
			) : null}
			<div className={styles.libraryBody}>
				{matches.length === 0 ? (
					<p className={styles.libraryEmpty}>{t('documents.markupSymbolNoResults')}</p>
				) : !searching && category === 'all' ? (
					SYMBOL_CATEGORIES.map((section) => (
						<section key={section.id}>
							<h4 className={styles.librarySectionTitle}>{t(section.labelKey)}</h4>
							<div className={styles.libraryGrid}>{matches.filter((definition) => definition.category === section.id).map(tile)}</div>
						</section>
					))
				) : (
					<div className={styles.libraryGrid}>{matches.map(tile)}</div>
				)}
			</div>
		</div>
	);
}
