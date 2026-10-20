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
		changedUserId: typeof raw.changedUserId === 'string' ? raw.changedUserId : null,
		// All actors in a coalesced note-change burst, most recent first. Must be carried through
		// here or the Redis path silently degrades to single attribution while the direct in-process
		// path keeps all of it - a difference that would only show up on a multi-instance deploy.
		changedUserIds: Array.isArray(raw.changedUserIds)
			? raw.changedUserIds.filter((value) => typeof value === 'string' && value.length > 0)
			: [],
		profileImageUrl: typeof raw.profileImageUrl === 'string' ? raw.profileImageUrl : null,
		userIds: Array.isArray(raw.userIds)
			? raw.userIds.filter((value) => typeof value === 'string' && value.length > 0)
			: [],
		origin: typeof raw.origin === 'string' ? raw.origin : null,
		occurredAt: typeof raw.occurredAt === 'string' ? raw.occurredAt : new Date().toISOString(),
	};
	return event;
}

/**
 * The event as a browser receives it.
 *
 * This used to be an inline object literal in `server.js`'s broadcast function - a hand-written
 * allow-list of fields, forty lines away from the normaliser that defines the shape. Adding
 * `changedUserIds` to the normaliser and to the Redis publisher was therefore not enough: the
 * socket serialiser silently dropped it, so the server computed the full list of people who
 * changed a note and then threw all but one away on the last line before the wire. Measured, after
 * a passing unit test on the emitting side had said it worked.
 *
 * It lives here now so the wire contract sits beside the shape it serialises, and so it can be
 * tested without starting a server.
 *
 * `userIds` is deliberately NOT included: it is the recipient filter the broadcaster uses to decide
 * who to send to, and shipping it would hand every recipient the list of everyone else with access.
 */
function toClientMetadataPayload(event) {
	return {
		type: 'workspace-metadata-changed',
		reason: event.reason,
		workspaceId: event.workspaceId,
		docId: event.docId,
		changedUserId: event.changedUserId,
		changedUserIds: event.changedUserIds,
		profileImageUrl: event.profileImageUrl,
		occurredAt: event.occurredAt,
	};
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
	toClientMetadataPayload,
	publishWorkspaceMetadataEvent,
	subscribeToWorkspaceMetadataEvents,
};