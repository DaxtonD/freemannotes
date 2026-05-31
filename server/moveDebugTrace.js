'use strict';

const MAX_TRACE_COUNT = 64;
const MAX_EVENTS_PER_TRACE = 240;
const TRACE_TTL_MS = 30 * 60 * 1000;

// Move traces are intentionally in-memory only. They are short-lived diagnostics for
// one reproduction and should never grow without bound or survive a server restart.
const traces = new Map();

function normalizeMoveDebugTraceId(value) {
	const normalized = typeof value === 'string' ? value.trim() : '';
	return normalized || null;
}

function pruneExpiredTraces() {
	const cutoff = Date.now() - TRACE_TTL_MS;
	for (const [traceId, trace] of traces.entries()) {
		if ((trace && trace.updatedAt) >= cutoff) continue;
		traces.delete(traceId);
	}
}

function trimTraceCount() {
	while (traces.size > MAX_TRACE_COUNT) {
		const oldestTraceId = traces.keys().next().value;
		if (!oldestTraceId) return;
		traces.delete(oldestTraceId);
	}
}

function ensureTrace(traceId) {
	let trace = traces.get(traceId);
	if (trace) return trace;
	trace = {
		traceId,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		events: [],
	};
	traces.set(traceId, trace);
	trimTraceCount();
	return trace;
}

function recordMoveDebugTrace(traceId, event, data = {}) {
	const normalizedTraceId = normalizeMoveDebugTraceId(traceId);
	const normalizedEvent = typeof event === 'string' ? event.trim() : '';
	if (!normalizedTraceId || !normalizedEvent) return;
	pruneExpiredTraces();
	const trace = ensureTrace(normalizedTraceId);
	trace.updatedAt = Date.now();
	trace.events.push({
		time: new Date().toISOString(),
		event: normalizedEvent,
		...data,
	});
	if (trace.events.length > MAX_EVENTS_PER_TRACE) {
		trace.events.splice(0, trace.events.length - MAX_EVENTS_PER_TRACE);
	}
	traces.delete(normalizedTraceId);
	traces.set(normalizedTraceId, trace);
	trimTraceCount();
}

function getMoveDebugTrace(traceId) {
	const normalizedTraceId = normalizeMoveDebugTraceId(traceId);
	if (!normalizedTraceId) return null;
	pruneExpiredTraces();
	const trace = traces.get(normalizedTraceId);
	if (!trace) return null;
	return {
		traceId: normalizedTraceId,
		createdAt: new Date(trace.createdAt).toISOString(),
		updatedAt: new Date(trace.updatedAt).toISOString(),
		events: trace.events.slice(),
	};
}

module.exports = {
	normalizeMoveDebugTraceId,
	recordMoveDebugTrace,
	getMoveDebugTrace,
};