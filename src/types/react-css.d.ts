import 'react';

declare module 'react' {
	interface CSSProperties {
		// Sidebar/layout code writes this CSS custom property through React style objects.
		'--sidebar-item-index'?: number | string;
	}
}