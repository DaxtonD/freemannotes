'use strict';

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');

async function main() {
	const prisma = new PrismaClient();
	try {
		const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
		console.log('DATABASE_URL:', url ? `${url.protocol}//${url.host}${url.pathname}` : '(not set)');

		const counts = {
			userPreference: await prisma.userPreference.count(),
			userDevicePreference: await prisma.userDevicePreference.count(),
		};
		console.log('counts:', counts);

		const latest = await prisma.userDevicePreference.findMany({
			take: 10,
			orderBy: { updatedAt: 'desc' },
			select: {
				userId: true,
				deviceId: true,
				theme: true,
				language: true,
				activeWorkspaceId: true,
				checklistShowCompleted: true,
				updatedAt: true,
			},
		});
		console.log('latest userDevicePreference:', latest);
	} finally {
		await prisma.$disconnect();
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
