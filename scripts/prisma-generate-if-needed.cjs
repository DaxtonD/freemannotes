'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const schemaPath = path.join(rootDir, 'prisma', 'schema.prisma');
const generatedSchemaPath = path.join(rootDir, 'node_modules', '.prisma', 'client', 'schema.prisma');
const generatedIndexPath = path.join(rootDir, 'node_modules', '.prisma', 'client', 'index.js');
let prismaCliEntrypoint = null;
const RETRY_DELAY_MS = 750;
const MAX_ATTEMPTS = 3;

try {
	prismaCliEntrypoint = require.resolve('prisma/build/index.js', { paths: [rootDir] });
} catch {
	prismaCliEntrypoint = null;
}

function readText(filePath) {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch {
		return null;
	}
}

function fileExists(filePath) {
	try {
		return fs.existsSync(filePath);
	} catch {
		return false;
	}
}

function getMtimeMs(filePath) {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isTransientEngineLock(output) {
	const message = String(output || '').toLowerCase();
	return (message.includes('eperm') || message.includes('ebusy'))
		&& message.includes('query_engine')
		&& message.includes('rename');
}

function shouldGenerate() {
	if (process.env.PRISMA_FORCE_GENERATE === '1') {
		return { needed: true, reason: 'forced via PRISMA_FORCE_GENERATE=1' };
	}

	if (!fileExists(generatedIndexPath) || !fileExists(generatedSchemaPath)) {
		return { needed: true, reason: 'generated Prisma Client files are missing' };
	}

	const sourceSchemaMtime = getMtimeMs(schemaPath);
	const generatedSchemaMtime = getMtimeMs(generatedSchemaPath);
	const generatedIndexMtime = getMtimeMs(generatedIndexPath);
	if (!sourceSchemaMtime || !generatedSchemaMtime || !generatedIndexMtime) {
		return { needed: true, reason: 'unable to read Prisma Client timestamps' };
	}

	const generatedClientMtime = Math.min(generatedSchemaMtime, generatedIndexMtime);
	if (generatedClientMtime < sourceSchemaMtime) {
		return { needed: true, reason: 'prisma/schema.prisma changed since the last client generate' };
	}

	return { needed: false, reason: 'generated Prisma Client is already current' };
}

const decision = shouldGenerate();
if (!decision.needed) {
	console.log(`[prisma] Skipping generate: ${decision.reason}.`);
	process.exit(0);
}

if (!prismaCliEntrypoint || !fileExists(prismaCliEntrypoint)) {
	console.error('[prisma] Prisma CLI entrypoint was not found in node_modules/prisma.');
	process.exit(1);
}

console.log(`[prisma] Running generate: ${decision.reason}.`);


for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
	const result = spawnSync(process.execPath, [prismaCliEntrypoint, 'generate'], {
		cwd: rootDir,
		env: process.env,
		encoding: 'utf8',
		stdio: 'pipe',
	});

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);

	if (typeof result.status === 'number' && result.status === 0) {
		process.exit(0);
	}

	if (result.error) {
		console.error(`[prisma] Failed to launch Prisma CLI: ${result.error.message}`);
		process.exit(1);
	}

	const combinedOutput = `${result.stdout || ''}\n${result.stderr || ''}`;
	if (attempt < MAX_ATTEMPTS && isTransientEngineLock(combinedOutput)) {
		console.warn(`[prisma] Generate hit a transient engine lock. Retrying in ${RETRY_DELAY_MS}ms (${attempt}/${MAX_ATTEMPTS})...`);
		sleep(RETRY_DELAY_MS);
		continue;
	}

	if (typeof result.status === 'number') {
		process.exit(result.status);
	}

	process.exit(1);
}

process.exit(1);