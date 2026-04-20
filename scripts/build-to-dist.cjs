'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const vitePackageJsonPath = require.resolve('vite/package.json', { paths: [rootDir] });
const vitePackageJson = JSON.parse(fs.readFileSync(vitePackageJsonPath, 'utf8'));
const viteBinRelativePath = typeof vitePackageJson.bin === 'string'
	? vitePackageJson.bin
	: vitePackageJson.bin?.vite;
const FS_RETRY_DELAY_MS = 500;
const FS_RETRY_ATTEMPTS = 6;

if (!viteBinRelativePath) {
	throw new Error('Unable to resolve the Vite CLI entrypoint from vite/package.json');
}

const viteCliEntrypoint = path.resolve(path.dirname(vitePackageJsonPath), viteBinRelativePath);
const defaultOutDirName = 'dist';
const tempOutDirName = 'dist-build-temp';
const backupOutDirName = 'dist-build-backup';
const defaultOutDir = path.join(rootDir, defaultOutDirName);
const tempOutDir = path.join(rootDir, tempOutDirName);
const backupOutDir = path.join(rootDir, backupOutDirName);
const forwardedArgs = process.argv.slice(2);

function hasExplicitOutDir(args) {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--outDir') return true;
		if (typeof arg === 'string' && arg.startsWith('--outDir=')) return true;
	}
	return false;
}

function sleep(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableFsError(error) {
	const code = error?.code;
	return code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EEXIST';
}

function withFsRetry(action, description) {
	for (let attempt = 1; attempt <= FS_RETRY_ATTEMPTS; attempt += 1) {
		try {
			return action();
		} catch (error) {
			if (!isRetryableFsError(error) || attempt === FS_RETRY_ATTEMPTS) {
				throw error;
			}
			console.warn(`[build] ${description} failed with ${error.code}. Retrying in ${FS_RETRY_DELAY_MS}ms (${attempt}/${FS_RETRY_ATTEMPTS})...`);
			sleep(FS_RETRY_DELAY_MS);
		}
	}
	return undefined;
}

function removeIfPresent(targetPath) {
	withFsRetry(() => {
		fs.rmSync(targetPath, { recursive: true, force: true });
	}, `Removing ${path.relative(rootDir, targetPath) || targetPath}`);
	return undefined;
}

function renameWithRetry(sourcePath, targetPath) {
	withFsRetry(() => {
		fs.renameSync(sourcePath, targetPath);
	}, `Renaming ${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)}`);
	return undefined;
}

function copyDirectoryWithRetry(sourcePath, targetPath) {
	withFsRetry(() => {
		fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
	}, `Copying ${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)}`);
	return undefined;
}

function moveOrCopyDirectory(sourcePath, targetPath) {
	try {
		renameWithRetry(sourcePath, targetPath);
		return;
	} catch (error) {
		if (!isRetryableFsError(error)) {
			throw error;
		}
		console.warn(`[build] Rename fallback engaged for ${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)}.`);
		removeIfPresent(targetPath);
		copyDirectoryWithRetry(sourcePath, targetPath);
		removeIfPresent(sourcePath);
	}
}

function ensureCompleteBuild(targetPath) {
	const indexHtmlPath = path.join(targetPath, 'index.html');
	if (!fs.existsSync(indexHtmlPath)) {
		throw new Error(`Build output is incomplete: missing ${path.relative(rootDir, indexHtmlPath)}`);
	}
}

function runViteBuild(args) {
	const result = spawnSync(process.execPath, [viteCliEntrypoint, 'build', ...args], {
		cwd: rootDir,
		env: process.env,
		stdio: 'inherit',
	});
	if (typeof result.status === 'number') {
		process.exit(result.status);
	}
	if (result.error) {
		console.error(`[build] Failed to launch Vite: ${result.error.message}`);
	}
	process.exit(1);
}

if (hasExplicitOutDir(forwardedArgs)) {
	runViteBuild(forwardedArgs);
}

removeIfPresent(tempOutDir);
removeIfPresent(backupOutDir);

const buildResult = spawnSync(process.execPath, [viteCliEntrypoint, 'build', '--outDir', tempOutDirName, ...forwardedArgs], {
	cwd: rootDir,
	env: process.env,
	stdio: 'inherit',
});

if (buildResult.error) {
	console.error(`[build] Failed to launch Vite: ${buildResult.error.message}`);
	process.exit(1);
}

if (buildResult.status !== 0) {
	process.exit(buildResult.status ?? 1);
}

try {
	ensureCompleteBuild(tempOutDir);
	removeIfPresent(backupOutDir);
	if (fs.existsSync(defaultOutDir)) {
		moveOrCopyDirectory(defaultOutDir, backupOutDir);
	}
	moveOrCopyDirectory(tempOutDir, defaultOutDir);
	removeIfPresent(backupOutDir);
	process.exit(0);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[build] Failed to publish verified dist: ${message}`);
	try {
		if (fs.existsSync(defaultOutDir)) {
			removeIfPresent(defaultOutDir);
		}
		if (fs.existsSync(backupOutDir)) {
			moveOrCopyDirectory(backupOutDir, defaultOutDir);
		}
	} catch (restoreError) {
		const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
		console.error(`[build] Failed to restore previous dist: ${restoreMessage}`);
	}
	removeIfPresent(tempOutDir);
	process.exit(1);
}