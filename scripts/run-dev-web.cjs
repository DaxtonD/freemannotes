'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
try {
	require('dotenv').config({ path: path.join(rootDir, '.env') });
} catch {
	// Best effort only; the wrapper needs project env before defaulting proxy and
	// public-origin settings for reverse-proxied dev domains.
}
const env = { ...process.env };

if (!String(env.VITE_API_PROXY_TARGET || '').trim()) {
	const targetPort = String(env.PORT || '').trim() || '27016';
	env.VITE_API_PROXY_TARGET = `http://localhost:${targetPort}`;
}

if (!String(env.VITE_DEV_PUBLIC_ORIGIN || '').trim()) {
	const appUrl = String(env.APP_URL || '').trim();
	if (appUrl) {
		env.VITE_DEV_PUBLIC_ORIGIN = appUrl;
	}
}

function resolveViteEntrypoint() {
	const vitePackageJsonPath = require.resolve('vite/package.json', { paths: [rootDir] });
	const vitePackageJson = JSON.parse(fs.readFileSync(vitePackageJsonPath, 'utf8'));
	const viteBinRelativePath = typeof vitePackageJson.bin === 'string' ? vitePackageJson.bin : vitePackageJson.bin?.vite;
	if (!viteBinRelativePath) {
		throw new Error('Unable to resolve Vite CLI entrypoint');
	}
	return path.resolve(path.dirname(vitePackageJsonPath), viteBinRelativePath);
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: rootDir,
			env,
			stdio: 'inherit',
		});
		child.on('error', reject);
		child.on('exit', (code, signal) => {
			if (signal) {
				resolve(1);
				return;
			}
			resolve(code ?? 0);
		});
	});
}

(async () => {
	const waitExitCode = await run(process.execPath, [path.join(rootDir, 'server', 'waitForServer.js')]);
	if (waitExitCode !== 0) {
		process.exit(waitExitCode);
	}
	const viteExitCode = await run(process.execPath, [resolveViteEntrypoint(), '--host']);
	process.exit(viteExitCode);
})().catch((error) => {
	console.error('[dev:web] Failed to launch Vite dev server:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});