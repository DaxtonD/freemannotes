'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const env = { ...process.env };

if (!String(env.PORT || '').trim()) {
	env.PORT = '27016';
}

if (!String(env.APP_URL || '').trim()) {
	env.APP_URL = `http://localhost:${env.PORT}`;
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
	const dbInitExitCode = await run(process.execPath, [path.join(rootDir, 'server', 'dbInitCli.js')]);
	if (dbInitExitCode !== 0) {
		process.exit(dbInitExitCode);
	}
	const watchExitCode = await run(process.execPath, ['--watch', path.join(rootDir, 'server.js')]);
	process.exit(watchExitCode);
})().catch((error) => {
	console.error('[dev:server] Failed to launch dev server:', error instanceof Error ? error.message : String(error));
	process.exit(1);
});