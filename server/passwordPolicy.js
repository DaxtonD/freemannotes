'use strict';

// Keep password scoring centralized so registration, admin-created users,
// and admin resets all enforce the same baseline.
function getPasswordStrength(password) {
	const value = String(password || '');
	let score = 0;
	if (value.length >= 8) score += 1;
	if (value.length >= 12) score += 1;
	if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
	if (/\d/.test(value)) score += 1;
	if (/[^A-Za-z0-9]/.test(value)) score += 1;
	return Math.min(score, 4);
}

function validatePassword(password) {
	const value = String(password || '');
	// Require a minimum length plus at least one additional strength signal.
	// This stays simple enough for the client meter to mirror exactly.
	if (value.length < 8) {
		return 'Password must be at least 8 characters';
	}
	if (getPasswordStrength(value) < 2) {
		return 'Password is too weak';
	}
	return null;
}

module.exports = {
	getPasswordStrength,
	validatePassword,
};