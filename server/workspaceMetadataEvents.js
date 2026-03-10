'use strict';

// Redis pub/sub channel for cross-process workspace metadata updates.
// HTTP handlers publish here after create/delete/rename so every app instance can
// nudge connected browsers to refresh cached workspace lists and active workspace state.
const WORKSPACE_METADATA_CHANNEL = 'freemannotes:workspace:metadata';

// Defensive parser for pub/sub payloads. We normalize shape and defaults here so
// websocket broadcasting and route handlers can rely on a stable event contract.
function normalizeWorkspaceMetadataEvent(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const event = {
		type: typeof raw.type === 'string' ? raw.type : 'workspace-metadata-changed',
		reason: typeof raw.reason === 'string' ? raw.reason : 'workspace-updated',
		workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : null,
		docId: typeof raw.docId === 'string' ? raw.docId : null,
		userIds: Array.isArray(raw.userIds)
			? raw.userIds.filter((value) => typeof value === 'string' && value.length > 0)
			: [],
		origin: typeof raw.origin === 'string' ? raw.origin : null,
		occurredAt: typeof raw.occurredAt === 'string' ? raw.occurredAt : new Date().toISOString(),
	};
	return event;
}

// Publish only normalized events so every subscriber sees consistent fields even if
// individual routes omit optional properties.
async function publishWorkspaceMetadataEvent(redis, payload) {
	if (!redis) return;
	const event = normalizeWorkspaceMetadataEvent(payload);
	if (!event) return;
	await redis.publish(WORKSPACE_METADATA_CHANNEL, JSON.stringify(event));
}

// Subscribe one process-local callback to Redis and return an unsubscribe cleanup.
// The returned function is intentionally best-effort because shutdown/reload paths
// should not crash if Redis is already gone.
async function subscribeToWorkspaceMetadataEvents(redisSubscriber, onEvent) {
	if (!redisSubscriber) {
		return async () => {};
	}

	const handleMessage = (channel, message) => {
		if (channel !== WORKSPACE_METADATA_CHANNEL) return;
		try {
			const parsed = JSON.parse(String(message || ''));
			const event = normalizeWorkspaceMetadataEvent(parsed);
			if (!event) return;
			onEvent(event);
		} catch (err) {
			console.warn('[workspace-events] invalid Redis payload:', err.message);
		}
	};

	redisSubscriber.on('message', handleMessage);
	await redisSubscriber.subscribe(WORKSPACE_METADATA_CHANNEL);

	return async () => {
		try {
			redisSubscriber.off('message', handleMessage);
			await redisSubscriber.unsubscribe(WORKSPACE_METADATA_CHANNEL);
		} catch {
			// Best-effort cleanup only.
		}
	};
}

module.exports = {
	WORKSPACE_METADATA_CHANNEL,
	normalizeWorkspaceMetadataEvent,
	publishWorkspaceMetadataEvent,
	subscribeToWorkspaceMetadataEvents,
};