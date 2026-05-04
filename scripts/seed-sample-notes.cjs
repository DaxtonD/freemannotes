#!/usr/bin/env node

require('dotenv').config();

const crypto = require('node:crypto');
const Y = require('yjs');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const NOTES_REGISTRY_ID = '__notes_registry__';
const REDIS_TTL_SECONDS = 86400;

const textTopics = [
	'Project planning',
	'Weekly review',
	'Household ideas',
	'Reading notes',
	'Health routine',
	'Travel prep',
	'Garden log',
	'Recipe tweaks',
	'Workshop notes',
	'Learning backlog',
];

const textOpeners = [
	'Start with the smallest useful version and tighten after feedback.',
	'Capture the constraint before outlining the solution.',
	'Prefer a repeatable routine over a perfect one-off push.',
	'Write down the decision while the tradeoff is still fresh.',
	'Leave the next action obvious so restart cost stays low.',
];

const textClosers = [
	'Follow up tomorrow with one concrete improvement.',
	'Review again at the end of the week and trim anything stale.',
	'Keep the scope narrow enough to finish in one sitting.',
	'Flag open questions instead of hiding them in the draft.',
	'Reuse this note as the working baseline for the next pass.',
];

const checklistThemes = [
	'Morning reset',
	'Launch checklist',
	'Weekly admin',
	'Packing list',
	'Home maintenance',
	'Errands batch',
	'Content workflow',
	'Client follow-up',
	'Desk reset',
	'Weekend prep',
];

const checklistItems = [
	'Confirm the priority for today',
	'Review the latest notes and action items',
	'Clear quick replies and short admin tasks',
	'Prepare the next focused work block',
	'Capture blockers before context switching',
	'File reference links in the right place',
	'Close out anything waiting on a tiny decision',
	'Leave a handoff note for the next session',
	'Reset the workspace for the next pass',
	'Archive anything already finished',
];

function parseArgs(argv) {
	const options = {
		count: 500,
		workspaceId: null,
		email: null,
		dryRun: false,
		verifyOnly: false,
	};

	for (const arg of argv) {
		if (arg.startsWith('--count=')) {
			options.count = Math.max(1, Number.parseInt(arg.slice('--count='.length), 10) || 500);
			continue;
		}
		if (arg.startsWith('--workspace-id=')) {
			options.workspaceId = arg.slice('--workspace-id='.length).trim() || null;
			continue;
		}
		if (arg.startsWith('--email=')) {
			options.email = arg.slice('--email='.length).trim().toLowerCase() || null;
			continue;
		}
		if (arg === '--dry-run') {
			options.dryRun = true;
			continue;
		}
		if (arg === '--verify-only') {
			options.verifyOnly = true;
		}
	}

	return options;
}

function makeRoomDocId(workspaceId, rawDocId) {
	return `${workspaceId}:${rawDocId}`;
}

function ensureRegistryStructure(doc) {
	doc.getArray('notesList');
	doc.getArray('noteOrder');
	doc.getMap('noteLayout');
}

function loadRegistryDoc(state) {
	const doc = new Y.Doc();
	ensureRegistryStructure(doc);
	if (state && state.length > 0) {
		Y.applyUpdate(doc, new Uint8Array(state));
	}
	return doc;
}

function removeExistingRegistryEntry(notesList, noteOrder, noteId) {
	for (let index = notesList.length - 1; index >= 0; index--) {
		const entry = notesList.get(index);
		if (String(entry?.get?.('id') ?? '').trim() === noteId) {
			notesList.delete(index, 1);
		}
	}
	for (let index = noteOrder.length - 1; index >= 0; index--) {
		if (String(noteOrder.get(index) ?? '').trim() === noteId) {
			noteOrder.delete(index, 1);
		}
	}
}

function makeTextBody(index) {
	const topic = textTopics[index % textTopics.length];
	const opener = textOpeners[index % textOpeners.length];
	const closer = textClosers[index % textClosers.length];
	return [
		`${opener}`,
		`${topic} note ${String(index + 1).padStart(3, '0')} keeps a few concrete details in one place so the workspace feels populated and realistic during testing.`,
		`${closer}`,
	].join('\n\n');
}

function buildTextDoc(title, body, timestampMs) {
	const doc = new Y.Doc();
	doc.transact(() => {
		doc.getText('title').insert(0, title);
		doc.getText('content').insert(0, body);
		const metadata = doc.getMap('metadata');
		metadata.set('type', 'text');
		metadata.set('createdAt', timestampMs);
		metadata.set('updatedAt', timestampMs);
		metadata.set('trashed', false);
		metadata.set('trashedAt', null);
		metadata.set('archived', false);
		metadata.set('archivedAt', null);
		metadata.set('colorToken', null);
		metadata.set('collectionId', null);
		metadata.set('labelIds', []);
		metadata.set('reminderAt', null);
		metadata.set('isPinned', false);
		metadata.set('lastAccessedAt', new Date(timestampMs).toISOString());
	});
	return doc;
}

function buildChecklistDoc(title, rows, timestampMs) {
	const doc = new Y.Doc();
	doc.transact(() => {
		doc.getText('title').insert(0, title);
		const metadata = doc.getMap('metadata');
		metadata.set('type', 'checklist');
		metadata.set('createdAt', timestampMs);
		metadata.set('updatedAt', timestampMs);
		metadata.set('trashed', false);
		metadata.set('trashedAt', null);
		metadata.set('archived', false);
		metadata.set('archivedAt', null);
		metadata.set('colorToken', null);
		metadata.set('collectionId', null);
		metadata.set('labelIds', []);
		metadata.set('reminderAt', null);
		metadata.set('isPinned', false);
		metadata.set('lastAccessedAt', new Date(timestampMs).toISOString());

		const checklist = doc.getArray('checklist');
		for (const row of rows) {
			const item = new Y.Map();
			item.set('id', row.id);
			item.set('text', row.text);
			item.set('completed', row.completed);
			item.set('parentId', null);
			item.set('countValue', null);
			if (row.completed) {
				item.set('completedAt', timestampMs + row.offsetMs);
			}
			checklist.push([item]);
		}
	});
	return doc;
}

function buildChecklistRows(index) {
	const rowCount = 4 + (index % 4);
	const rows = [];
	for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
		rows.push({
			id: crypto.randomUUID(),
			text: checklistItems[(index + rowIndex) % checklistItems.length],
			completed: rowIndex < (index % 3),
			offsetMs: rowIndex * 1000,
		});
	}
	return rows;
}

function makeRedisKey(workspaceId, docId) {
	return `fn:yjs:${workspaceId}:${docId}`;
}

async function resolveTargetWorkspace(prisma, options) {
	if (options.workspaceId) {
		const workspace = await prisma.workspace.findFirst({
			where: { id: options.workspaceId, deletedAt: null },
			select: { id: true, name: true, ownerUserId: true, systemKind: true },
		});
		if (!workspace) {
			throw new Error(`Workspace not found: ${options.workspaceId}`);
		}
		return { workspace, reason: 'explicit workspace id' };
	}

	if (options.email) {
		const user = await prisma.user.findFirst({
			where: { email: options.email },
			select: { id: true, email: true },
		});
		if (!user) {
			throw new Error(`User not found for email: ${options.email}`);
		}
		const workspace = await prisma.workspace.findFirst({
			where: { ownerUserId: user.id, systemKind: 'PERSONAL', deletedAt: null },
			select: { id: true, name: true, ownerUserId: true, systemKind: true },
		});
		if (!workspace) {
			throw new Error(`No personal workspace found for ${options.email}`);
		}
		return { workspace, reason: `email match ${options.email}` };
	}

	const workspaces = await prisma.workspace.findMany({
		where: { systemKind: 'PERSONAL', deletedAt: null },
		select: { id: true, name: true, ownerUserId: true, systemKind: true, createdAt: true },
	});
	if (workspaces.length === 0) {
		throw new Error('No personal workspace rows found.');
	}
	if (workspaces.length === 1) {
		return { workspace: workspaces[0], reason: 'only personal workspace in database' };
	}

	const workspaceIds = workspaces.map((workspace) => workspace.id);
	const owners = Array.from(new Set(workspaces.map((workspace) => workspace.ownerUserId).filter(Boolean)));
	const [users, prefs] = await Promise.all([
		prisma.user.findMany({
			where: { id: { in: owners } },
			select: { id: true, email: true, lastLogin: true, createdAt: true },
		}),
		prisma.userDevicePreference.findMany({
			where: { activeWorkspaceId: { in: workspaceIds } },
			select: { userId: true, activeWorkspaceId: true, updatedAt: true, deviceId: true },
			orderBy: { updatedAt: 'desc' },
		}),
	]);

	const userById = new Map(users.map((user) => [user.id, user]));
	const latestPrefByWorkspaceId = new Map();
	for (const pref of prefs) {
		if (!pref.activeWorkspaceId || latestPrefByWorkspaceId.has(pref.activeWorkspaceId)) continue;
		latestPrefByWorkspaceId.set(pref.activeWorkspaceId, pref);
	}

	const ranked = workspaces
		.map((workspace) => {
			const owner = workspace.ownerUserId ? userById.get(workspace.ownerUserId) : null;
			const pref = latestPrefByWorkspaceId.get(workspace.id) || null;
			return {
				workspace,
				owner,
				pref,
				score: [
					pref ? new Date(pref.updatedAt).getTime() : 0,
					owner?.lastLogin ? new Date(owner.lastLogin).getTime() : 0,
					new Date(workspace.createdAt).getTime(),
				],
			};
		})
		.sort((left, right) => {
			for (let index = 0; index < left.score.length; index++) {
				if (right.score[index] !== left.score[index]) {
					return right.score[index] - left.score[index];
				}
			}
			return left.workspace.id.localeCompare(right.workspace.id);
		});

	const chosen = ranked[0];
	const ownerEmail = chosen.owner?.email || 'unknown owner';
	const reason = chosen.pref
		? `latest active workspace preference (${ownerEmail}, device ${chosen.pref.deviceId})`
		: `latest owner activity (${ownerEmail})`;
	return { workspace: chosen.workspace, reason };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const prisma = new PrismaClient();
	const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;

	try {
		const { workspace, reason } = await resolveTargetWorkspace(prisma, options);
		const registryDocId = makeRoomDocId(workspace.id, NOTES_REGISTRY_ID);
		const existingRegistryRow = await prisma.document.findUnique({
			where: { docId: registryDocId },
			select: { id: true, state: true },
		});
		const registryDoc = loadRegistryDoc(existingRegistryRow?.state || null);
		const notesList = registryDoc.getArray('notesList');
		const noteOrder = registryDoc.getArray('noteOrder');

		const existingCount = await prisma.document.count({
			where: {
				workspaceId: workspace.id,
				docId: { not: registryDocId },
			},
		});

		const noteRows = [];
		const registryEntries = [];
		let textCount = 0;
		let checklistCount = 0;

		for (let index = options.count - 1; index >= 0; index--) {
			const noteId = crypto.randomUUID();
			const titleIndex = options.count - index;
			const createdAt = Date.now() - titleIndex * 3_600_000;
			const isChecklist = titleIndex % 2 === 0;
			const rawDocId = noteId;
			const storedDocId = makeRoomDocId(workspace.id, rawDocId);
			const title = isChecklist
				? `${checklistThemes[titleIndex % checklistThemes.length]} ${String(titleIndex).padStart(3, '0')}`
				: `${textTopics[titleIndex % textTopics.length]} ${String(titleIndex).padStart(3, '0')}`;
			const noteDoc = isChecklist
				? buildChecklistDoc(title, buildChecklistRows(titleIndex), createdAt)
				: buildTextDoc(title, makeTextBody(titleIndex), createdAt);
			const state = Buffer.from(Y.encodeStateAsUpdate(noteDoc));
			const stateVector = Buffer.from(Y.encodeStateVector(noteDoc));

			noteRows.push({
				workspaceId: workspace.id,
				docId: storedDocId,
				state,
				stateVector,
			});
			registryEntries.push({ noteId: rawDocId, title });
			if (isChecklist) checklistCount += 1;
			else textCount += 1;
			noteDoc.destroy();
		}

		for (const entry of registryEntries) {
			removeExistingRegistryEntry(notesList, noteOrder, entry.noteId);
			const noteMap = new Y.Map();
			noteMap.set('id', entry.noteId);
			noteMap.set('title', entry.title);
			notesList.insert(0, [noteMap]);
			noteOrder.insert(0, [entry.noteId]);
		}

		const registryState = Buffer.from(Y.encodeStateAsUpdate(registryDoc));
		const registryStateVector = Buffer.from(Y.encodeStateVector(registryDoc));

		console.log(JSON.stringify({
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			reason,
			existingCount,
			inserting: options.count,
			textCount,
			checklistCount,
			dryRun: options.dryRun,
			verifyOnly: options.verifyOnly,
		}, null, 2));

		if (!options.dryRun && !options.verifyOnly) {
			await prisma.$transaction(async (tx) => {
				await tx.document.createMany({ data: noteRows });
				await tx.document.upsert({
					where: { docId: registryDocId },
					update: { state: registryState, stateVector: registryStateVector },
					create: {
						workspaceId: workspace.id,
						docId: registryDocId,
						state: registryState,
						stateVector: registryStateVector,
					},
				});
			});

			if (redis) {
				await redis.connect().catch(() => {});
				if (redis.status === 'ready') {
					const pipeline = redis.pipeline();
					pipeline.set(makeRedisKey(workspace.id, registryDocId), registryState, 'EX', REDIS_TTL_SECONDS);
					for (const row of noteRows) {
						pipeline.set(makeRedisKey(workspace.id, row.docId), row.state, 'EX', REDIS_TTL_SECONDS);
					}
					await pipeline.exec();
				}
			}
		}

		const verificationRow = await prisma.document.findUnique({
			where: { docId: registryDocId },
			select: { state: true },
		});
		const verificationDoc = loadRegistryDoc(verificationRow?.state || null);
		const persistedNoteDocs = await prisma.document.count({
			where: {
				workspaceId: workspace.id,
				docId: { not: registryDocId },
			},
		});
		console.log(JSON.stringify({
			verification: {
				workspaceId: workspace.id,
				persistedNoteDocs,
				noteOrderLength: verificationDoc.getArray('noteOrder').length,
				notesListLength: verificationDoc.getArray('notesList').length,
			},
		}, null, 2));
		verificationDoc.destroy();

		registryDoc.destroy();
		if (options.verifyOnly) {
			console.log(`Verification complete for workspace ${workspace.id}.`);
		} else if (options.dryRun) {
			console.log(`Dry run complete for workspace ${workspace.id}. No data was written.`);
		} else {
			console.log(`Seed complete for workspace ${workspace.id}. Added ${options.count} sample notes.`);
		}
	} finally {
		await prisma.$disconnect();
		if (redis) {
			await redis.quit().catch(() => redis.disconnect());
		}
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});