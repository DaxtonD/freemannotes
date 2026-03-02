'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Automatic Database Initialization & Schema Sync (Phase 10)
//
// This module ensures the PostgreSQL database exists and the Prisma schema is
// up-to-date every time the server starts. It is called early in the server
// boot sequence so that all subsequent Prisma queries (persistence adapter,
// workspace init, etc.) can rely on a fully-provisioned database.
//
// Responsibilities:
//   1. Parse DATABASE_URL to extract the target database name.
//   2. Connect to the default "postgres" admin database (which always exists).
//   3. Check if the target database exists (pg_database catalog lookup).
//   4. CREATE DATABASE if it does not exist.
//   5. Sync the schema:
//      - Production (NODE_ENV=production): `prisma migrate deploy` applies
//        only committed migration files from prisma/migrations/.
//      - Development (all other values):   `prisma db push --skip-generate`
//        applies schema changes directly (no migration history).
//
// Design decisions:
//   - Uses the lightweight "pg" package for the admin-level connection because
//     Prisma's own client is generated for the target DB's schema and cannot
//     run `CREATE DATABASE` (PostgreSQL forbids it inside a transaction).
//   - Production uses `prisma migrate deploy` for safe, repeatable deployments.
//     Development uses `prisma db push` for rapid iteration without migration
//     files. This dual-mode approach ensures dev convenience AND prod safety.
//   - All operations are idempotent: running them repeatedly on an already-
//     provisioned database is a harmless no-op.
//   - Errors are surfaced as warnings, not fatal crashes, so the server can
//     still start in relay-only mode if PostgreSQL is temporarily unreachable.
//
// Usage:
//   const { ensureDatabase } = require('./server/dbInit');
//   await ensureDatabase(process.env.DATABASE_URL);
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const { execSync } = require('child_process');

/**
 * Parses a PostgreSQL connection URL and returns its component parts.
 *
 * @param {string} databaseUrl — Full PostgreSQL connection string.
 * @returns {{ adminUrl: string, dbName: string }} adminUrl points to the
 *   default "postgres" database; dbName is the target database name.
 */
function parseAdminUrl(databaseUrl) {
	// ── Parse the DATABASE_URL using the built-in URL constructor ─────────
	// Example: postgresql://user:pass@host:5432/mydb?schema=public
	const url = new URL(databaseUrl);

	// Extract the database name from the pathname (remove leading '/').
	const dbName = decodeURIComponent(url.pathname.slice(1));

	// Build an admin URL that points to the default "postgres" database.
	// This is the standard bootstrapping database that always exists in any
	// PostgreSQL installation. We keep all other connection parameters
	// (user, password, host, port, SSL settings) identical.
	const adminUrl = new URL(databaseUrl);
	adminUrl.pathname = '/postgres';

	return { adminUrl: adminUrl.toString(), dbName };
}

/**
 * Connects to the default "postgres" database to check whether the target
 * database exists. If it does not, creates it.
 *
 * Uses the "pg" npm package for this administrative operation because:
 *   - CREATE DATABASE cannot run inside a transaction block.
 *   - Prisma's query engine wraps statements in implicit transactions.
 *   - The "pg" package gives us full control over the connection.
 *
 * @param {string} adminUrl — Connection string pointing to the "postgres" DB.
 * @param {string} dbName   — Name of the target database to ensure exists.
 */
async function ensureDatabaseExists(adminUrl, dbName) {
	// ── Dynamically require "pg" — installed as a production dependency ──
	const { Client } = require('pg');

	const client = new Client({ connectionString: adminUrl });

	try {
		await client.connect();
		console.info(`[dbInit] Connected to PostgreSQL admin database`);

		// ── Check if target database already exists ──────────────────────
		// Query the pg_database system catalog. This is a read-only check
		// and works with any privilege level that can connect.
		const result = await client.query(
			'SELECT 1 FROM pg_database WHERE datname = $1',
			[dbName]
		);

		if (result.rowCount > 0) {
			console.info(`[dbInit] Database "${dbName}" already exists — no action needed`);
			return;
		}

		// ── Database does not exist — create it ─────────────────────────
		// Note: CREATE DATABASE cannot use parameterized queries ($1), so we
		// must interpolate the name. We sanitize it by escaping double-quotes
		// and wrapping in double-quote identifiers to prevent SQL injection.
		const safeName = dbName.replace(/"/g, '""');
		console.info(`[dbInit] Database "${dbName}" does not exist — creating...`);
		await client.query(`CREATE DATABASE "${safeName}"`);
		console.info(`[dbInit] Database "${dbName}" created successfully`);
	} finally {
		// Always close the admin connection, even if an error occurred.
		await client.end();
	}
}

/**
 * Synchronizes the Prisma schema with the database.
 *
 * Mode selection (based on NODE_ENV):
 *   - Production: `prisma migrate deploy` — applies only committed migration
 *     files from prisma/migrations/. Safe for production use; never auto-
 *     generates migrations or drops data.
 *   - Development: `prisma db push --skip-generate` — applies schema changes
 *     directly without migration files. Convenient for rapid iteration.
 *
 * @param {string} databaseUrl — Full PostgreSQL connection string for the
 *   target database (not the admin "postgres" database).
 */
function syncSchema(databaseUrl) {
	const isProduction = process.env.NODE_ENV === 'production';
	const command = isProduction
		? 'npx prisma migrate deploy 2>&1'
		: 'npx prisma db push --skip-generate 2>&1';
	const label = isProduction ? 'prisma migrate deploy' : 'prisma db push';

	console.info(`[dbInit] Syncing schema with database (${label})...`);

	try {
		// ── Execute the chosen Prisma command as a child process ─────────
		// We pass DATABASE_URL explicitly in the environment to ensure Prisma
		// reads the correct connection string regardless of .env file state.
		const output = execSync(command, {
			cwd: path.resolve(__dirname, '..'),
			stdio: 'pipe',
			timeout: 60000, // 60-second timeout for slow first-run migrations.
			env: {
				...process.env,
				DATABASE_URL: databaseUrl,
			},
		});

		// ── Parse and log the output ─────────────────────────────────────
		const text = output.toString().trim();
		if (text.includes('already in sync') || text.includes('No pending migrations')) {
			console.info('[dbInit] Schema is already in sync — no changes applied');
		} else if (text.includes('applied') || text.includes('migration')) {
			console.info('[dbInit] Schema changes applied successfully');
			// Log the full output so the user can see what changed.
			console.info('[dbInit] Prisma output:\n' + text);
		} else {
			console.info('[dbInit] Schema sync complete');
		}
	} catch (err) {
		// ── Handle failure ───────────────────────────────────────────────
		const stderr = err.stderr ? err.stderr.toString().trim() : '';
		const stdout = err.stdout ? err.stdout.toString().trim() : '';
		const message = stderr || stdout || err.message;

		console.warn('[dbInit] Schema sync encountered an issue:');
		console.warn('[dbInit] ' + message);

		if (isProduction) {
			console.warn('[dbInit] Production mode uses `prisma migrate deploy`.');
			console.warn('[dbInit] Ensure migration files exist in prisma/migrations/.');
			console.warn('[dbInit] To create a migration: npx prisma migrate dev --name <label>');
		} else {
			console.warn('[dbInit] If this is a destructive schema change, run manually:');
			console.warn('[dbInit]   npx prisma db push --accept-data-loss');
			console.warn('[dbInit] Or create a proper migration:');
			console.warn('[dbInit]   npx prisma migrate dev --name <label>');
		}
	}
}

/**
 * Main entrypoint — ensures the database exists and the schema is current.
 *
 * This function is safe to call on every server startup. All operations are
 * idempotent and non-destructive.
 *
 * @param {string} databaseUrl — Full PostgreSQL connection string.
 *   Example: postgresql://user:pass@host:5432/freemandev?schema=public
 */
async function ensureDatabase(databaseUrl) {
	if (!databaseUrl || databaseUrl.trim().length === 0) {
		console.info('[dbInit] No DATABASE_URL provided — skipping database initialization');
		return;
	}

	console.info('[dbInit] ─── Database Initialization ───────────────────────────');

	// ── Step 1: Parse connection details ─────────────────────────────────
	const { adminUrl, dbName } = parseAdminUrl(databaseUrl);
	console.info(`[dbInit] Target database: "${dbName}"`);

	// ── Step 2: Ensure the database exists (create if missing) ──────────
	try {
		await ensureDatabaseExists(adminUrl, dbName);
	} catch (err) {
		console.error(`[dbInit] Failed to check/create database "${dbName}":`, err.message);
		console.error('[dbInit] Ensure PostgreSQL is running and the connection URL is correct.');
		console.error('[dbInit] You may need to create the database manually:');
		console.error(`[dbInit]   CREATE DATABASE "${dbName}";`);
		// Don't return — still try schema sync in case the DB already exists
		// and the error was something else (e.g. insufficient admin privileges
		// to query pg_database, but the DB was already created by someone else).
	}

	// ── Step 3: Sync the Prisma schema (apply pending changes) ──────────
	syncSchema(databaseUrl);

	console.info('[dbInit] ─── Database Initialization Complete ──────────────────');
}

module.exports = { ensureDatabase };
