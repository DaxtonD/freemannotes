'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// FreemanNotes – Automatic Database Initialization & Schema Sync
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
//   5. Run `prisma db push --skip-generate` to apply any pending schema
//      changes WITHOUT data loss (no --accept-data-loss flag).
//
// Design decisions:
//   - Uses the lightweight "pg" package for the admin-level connection because
//     Prisma's own client is generated for the target DB's schema and cannot
//     run `CREATE DATABASE` (PostgreSQL forbids it inside a transaction).
//   - `prisma db push` (not `migrate deploy`) is used because the project does
//     not maintain a migration history yet. When a migrations directory is
//     added, this can be swapped to `prisma migrate deploy`.
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
 * Runs `prisma db push --skip-generate` to synchronize the Prisma schema
 * with the database. This applies any new tables, columns, or indexes
 * without dropping existing data.
 *
 * Key flags:
 *   --skip-generate : Skip client regeneration (already done at install time).
 *   (No --accept-data-loss) : Prisma will refuse destructive changes and
 *     return a non-zero exit code instead. This protects production data.
 *
 * @param {string} databaseUrl — Full PostgreSQL connection string for the
 *   target database (not the admin "postgres" database).
 */
function syncSchema(databaseUrl) {
	console.info('[dbInit] Syncing Prisma schema with database (prisma db push)...');

	try {
		// ── Execute prisma db push as a child process ────────────────────
		// We pass DATABASE_URL explicitly in the environment to ensure Prisma
		// reads the correct connection string regardless of .env file state.
		const output = execSync('npx prisma db push --skip-generate 2>&1', {
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
		if (text.includes('already in sync')) {
			console.info('[dbInit] Schema is already in sync — no changes applied');
		} else if (text.includes('applied')) {
			console.info('[dbInit] Schema changes applied successfully');
			// Log the full output so the user can see what changed.
			console.info('[dbInit] Prisma output:\n' + text);
		} else {
			console.info('[dbInit] Schema sync complete');
		}
	} catch (err) {
		// ── Handle prisma db push failure ────────────────────────────────
		// Without --accept-data-loss, Prisma exits non-zero when a schema
		// change would drop data. This is intentional — we log the warning
		// and let the operator decide how to proceed manually.
		const stderr = err.stderr ? err.stderr.toString().trim() : '';
		const stdout = err.stdout ? err.stdout.toString().trim() : '';
		const message = stderr || stdout || err.message;

		console.warn('[dbInit] Schema sync encountered an issue:');
		console.warn('[dbInit] ' + message);
		console.warn('[dbInit] If this is a destructive schema change, run manually:');
		console.warn('[dbInit]   npx prisma db push --accept-data-loss');
		console.warn('[dbInit] Or create a proper migration:');
		console.warn('[dbInit]   npx prisma migrate dev --name <label>');
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
