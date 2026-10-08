/**
 * Guesses which of the shipped banner categories a note is "about", from its title alone.
 *
 * This exists so a search result with no picture, no assigned banner and no colour gets something
 * topical instead of a generic glyph. The obvious alternative — looking an image up on the web
 * from the note's title — is not on the table here, and not for fussy reasons: it would send note
 * titles ("biopsy results", "severance terms") to a third party from an app whose entire premise
 * is self-hosting, and it would need the network in a product where offline-first is the one
 * non-negotiable. This gets most of the benefit for none of that: it is local, instant, free, and
 * it draws from the twenty banner sets the app already ships, so a guessed tile looks like it
 * belongs next to a deliberately-chosen one.
 *
 * It is decorative and it is allowed to be wrong. A miss costs a mildly odd picture, never a wrong
 * fact, so the matching leans towards answering rather than abstaining — but a title with no
 * recognisable keyword returns null rather than picking something arbitrary.
 */

/** The categories in `public/CardBanners/{Dark,Light}/`. Keep in sync if art is ever added. */
export type NoteBannerCategory =
	| 'calendar' | 'checklist' | 'coding' | 'finance' | 'gaming' | 'grocery' | 'health'
	| 'household' | 'ideas' | 'important' | 'industrial' | 'journal' | 'maintenance' | 'media'
	| 'reading' | 'recipes' | 'reminder' | 'school' | 'travel' | 'work';

// Longest match wins (see below), so a general word and a specific phrase can both live here
// without the general one swallowing the specific one.
const CATEGORY_KEYWORDS: Record<NoteBannerCategory, readonly string[]> = {
	grocery: ['grocery', 'groceries', 'shopping list', 'supermarket', 'pantry', 'produce', 'costco'],
	recipes: ['recipe', 'recipes', 'baking', 'cooking', 'dinner', 'breakfast', 'meal plan', 'ingredients'],
	coding: ['code', 'coding', 'bug report', 'bugfix', 'api', 'repo', 'git', 'github', 'gitlab', 'pull request', 'deploy', 'refactor', 'changelog', 'release notes', 'database', 'regex', 'stack trace', 'frontend', 'backend', 'typescript', 'javascript', 'python', 'sql', 'migration'],
	finance: ['budget', 'invoice', 'taxes', 'expense', 'expenses', 'salary', 'mortgage', 'receipt', 'insurance', 'rent', 'bills', 'banking', 'savings'],
	health: ['doctor', 'dentist', 'appointment', 'prescription', 'workout', 'medical', 'symptoms', 'therapy', 'pharmacy', 'clinic', 'fitness'],
	travel: ['travel', 'trip', 'flight', 'hotel', 'itinerary', 'passport', 'vacation', 'packing list', 'airport'],
	school: ['lecture', 'homework', 'exam', 'assignment', 'semester', 'coursework', 'thesis', 'study guide'],
	work: ['meeting', 'standup', 'client', 'deadline', 'performance review', 'onboarding', 'interview', 'retro', 'roadmap'],
	calendar: ['schedule', 'calendar', 'agenda', 'birthday', 'anniversary'],
	checklist: ['checklist', 'todo', 'to-do', 'to do', 'punch list', 'tasks'],
	reading: ['book', 'books', 'reading', 'article', 'chapter', 'library', 'podcast'],
	media: ['movie', 'movies', 'film', 'series', 'watchlist', 'music', 'album', 'playlist'],
	gaming: ['game', 'gaming', 'steam', 'xbox', 'playstation', 'nintendo', 'campaign'],
	household: ['chores', 'cleaning', 'laundry', 'garden', 'furniture', 'decor', 'moving house'],
	maintenance: ['repair', 'maintenance', 'oil change', 'plumbing', 'hvac', 'furnace', 'tune up', 'tune-up'],
	industrial: ['equipment', 'warehouse', 'inventory', 'shipment', 'machinery', 'jobsite', 'job site'],
	journal: ['journal', 'diary', 'daily log', 'gratitude', 'reflection'],
	ideas: ['idea', 'ideas', 'brainstorm', 'concept', 'sketches'],
	important: ['important', 'urgent', 'critical', 'emergency', 'warranty', 'contract', 'legal'],
	reminder: ['reminder', 'remember to', 'follow up', 'follow-up'],
};

/** Word-boundary-ish containment: "code" must not match "barcode" or "encoded". */
function containsKeyword(haystack: string, keyword: string): boolean {
	let from = 0;
	for (;;) {
		const index = haystack.indexOf(keyword, from);
		if (index === -1) return false;
		const before = index === 0 ? ' ' : haystack[index - 1];
		const afterIndex = index + keyword.length;
		const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
		// Trailing "s"/"es" is deliberately allowed so singular keywords cover their plurals.
		const afterOk = !/[a-z0-9]/.test(after) || (after === 's' && !/[a-z0-9]/.test(haystack[afterIndex + 1] ?? ' '));
		if (!/[a-z0-9]/.test(before) && afterOk) return true;
		from = index + 1;
	}
}

/**
 * The best category for `title`, or null when nothing matches confidently.
 *
 * Longest keyword wins, so "shopping list" beats "list" and "bug report" beats a bare "report"
 * if one is ever added — a longer phrase is usually the stronger signal.
 *
 * Usually, not always: length is a proxy for specificity and it is an imperfect one. "dentist
 * appointment" originally resolved to calendar, because the vague-but-long "appointment" outscored
 * the precise-but-short "dentist". The fix is to keep ambiguous words out of the lists rather than
 * to add weights — if a word genuinely belongs to two categories, it is not evidence for either.
 */
export function guessNoteBannerCategory(title: string): NoteBannerCategory | null {
	const normalized = String(title ?? '').toLowerCase().trim();
	if (normalized.length < 3) return null;

	let best: NoteBannerCategory | null = null;
	let bestLength = 0;
	for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [NoteBannerCategory, readonly string[]][]) {
		for (const keyword of keywords) {
			if (keyword.length <= bestLength) continue;
			if (containsKeyword(normalized, keyword)) {
				best = category;
				bestLength = keyword.length;
			}
		}
	}
	return best;
}
