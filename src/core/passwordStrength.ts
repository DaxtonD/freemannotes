export type PasswordStrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

// Mirror the server-side password policy so the client can show the same
// thresholds the API will enforce on submit.
export function getPasswordStrengthScore(password: string): number {
	const value = String(password || '');
	let score = 0;
	if (value.length >= 8) score += 1;
	if (value.length >= 12) score += 1;
	if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
	if (/\d/.test(value)) score += 1;
	if (/[^A-Za-z0-9]/.test(value)) score += 1;
	return Math.min(score, 4);
}

export function getPasswordStrengthLevel(password: string): PasswordStrengthLevel {
	// Convert the numeric score into UI-oriented buckets for badges and bars.
	const score = getPasswordStrengthScore(password);
	if (score >= 4) return 'strong';
	if (score === 3) return 'good';
	if (score === 2) return 'fair';
	return 'weak';
}

export function getPasswordStrengthLabel(password: string): string {
	const level = getPasswordStrengthLevel(password);
	if (level === 'strong') return 'Strong';
	if (level === 'good') return 'Good';
	if (level === 'fair') return 'Fair';
	return 'Weak';
}