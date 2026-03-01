#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Database Initialization CLI
//
// Standalone entry point for the database initialization module. This script
// is designed to be called from npm scripts (e.g. `dev:db`, `db:init`) or
// directly via `node server/dbInitCli.js`.
//
// It loads environment variables from .env (if present), then runs the full
// database provisioning sequence:
//   1. Check if the target PostgreSQL database exists → create if missing.
//   2. Sync the Prisma schema → apply any pending changes without data loss.
//
// If DATABASE_URL is not set, the script exits silently with code 0 (no-op).
// On failure, it exits with code 1 so that chained npm scripts (&&) stop.
//
// Usage:
//   node server/dbInitCli.js          # Uses .env for DATABASE_URL
//   DATABASE_URL=... node server/dbInitCli.js   # Explicit URL
// ─────────────────────────────────────────────────────────────────────────────

// Load .env before reading DATABASE_URL.
try {
	require('dotenv').config();
} catch {
	// dotenv is optional — DATABASE_URL might be set via the OS environment.
}

const { ensureDatabase } = require('./dbInit');

const databaseUrl = (process.env.DATABASE_URL || '').trim();

ensureDatabase(databaseUrl)
	.then(() => {
		// Success or no-op (no DATABASE_URL). Exit cleanly so chained commands run.
		process.exit(0);
	})
	.catch((err) => {
		console.error('[dbInitCli] Fatal error during database initialization:', err);
		process.exit(1);
	});
