'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// rateLimit.js — Lightweight in-memory rate limiting.
//
// This module provides a very small, dependency-free rate limiter that is
// sufficient for a single-process Node server.
//
// Characteristics:
//   - In-memory Map-based counters; resets on process restart.
//   - Sliding window semantics (approximate): we store per-key timestamps and
//     evict anything outside the window.
//   - Intended for coarse abuse prevention on endpoints like login/register/
//     invite creation. Not intended as a hard security boundary.
//
// Production notes:
//   - If the server is scaled horizontally, this limiter becomes per-instance.
//     For stronger guarantees, replace with Redis or another shared store.
// ─────────────────────────────────────────────────────────────────────────────

function nowMs() {
	return Date.now();
}

function getClientIp(req) {
	// Prefer X-Forwarded-For when present so proxy deployments rate-limit on the
	// true client IP.
	const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
	return fwd || req.socket?.remoteAddress || 'unknown';
}

function createRateLimiter({ windowMs, max }) {
	// `hits` maps key -> sorted list of timestamps (ms) within the window.
	const hits = new Map();

	function cleanup() {
		const cutoff = nowMs() - windowMs * 2;
		for (const [key, arr] of hits.entries()) {
			// arr is sorted by insertion.
			while (arr.length > 0 && arr[0] < cutoff) arr.shift();
			if (arr.length === 0) hits.delete(key);
		}
	}

	function allow(key) {
		cleanup();
		const t = nowMs();
		const arr = hits.get(key) || [];
		while (arr.length > 0 && arr[0] <= t - windowMs) arr.shift();
		arr.push(t);
		hits.set(key, arr);
		return arr.length <= max;
	}

	return { allow };
}

module.exports = { createRateLimiter, getClientIp };
