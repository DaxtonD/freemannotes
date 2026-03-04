'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// mailer.js — SMTP email helper (currently used for invitations).
//
// This module intentionally keeps email logic small and explicit:
//   - Reads SMTP configuration from environment variables.
//   - Lazily creates a Nodemailer transport and reuses it.
//   - Throws a clear error when SMTP is not configured.
//
// Required env vars:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Optional:
//   SMTP_SECURE (boolean-ish) — defaults to true when port is 465.
//
// Failure modes:
//   - If SMTP is misconfigured, invite creation should fail fast with a
//     helpful error message (rather than silently dropping emails).
// ─────────────────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

function boolFromEnv(value, fallback = false) {
	if (value == null || value === '') return fallback;
	const v = String(value).trim().toLowerCase();
	if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
	if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
	return fallback;
}

function getSmtpConfig() {
	const host = String(process.env.SMTP_HOST || '').trim();
	const port = Number(process.env.SMTP_PORT || 587);
	const secure = boolFromEnv(process.env.SMTP_SECURE, port === 465);
	const user = String(process.env.SMTP_USER || '').trim();
	const pass = String(process.env.SMTP_PASS || '').trim();
	const from = String(process.env.SMTP_FROM || '').trim();

	if (!host || !port || !user || !pass || !from) {
		const err = new Error('SMTP is not configured (SMTP_HOST/PORT/USER/PASS/FROM)');
		err.code = 'SMTP_MISCONFIGURED';
		throw err;
	}

	return { host, port, secure, user, pass, from };
}

let cachedTransport = null;

function getTransport() {
	if (cachedTransport) return cachedTransport;
	const cfg = getSmtpConfig();
	cachedTransport = nodemailer.createTransport({
		host: cfg.host,
		port: cfg.port,
		secure: cfg.secure,
		auth: { user: cfg.user, pass: cfg.pass },
	});
	return cachedTransport;
}

async function sendInviteEmail({ to, workspaceName, inviteUrl }) {
	const cfg = getSmtpConfig();
	const transport = getTransport();

	await transport.sendMail({
		from: cfg.from,
		to,
		subject: `You're invited to join ${workspaceName}`,
		text: `You have been invited to join the workspace "${workspaceName}".\n\nAccept invite: ${inviteUrl}\n\nIf you did not expect this email, you can ignore it.`,
	});
}

module.exports = { sendInviteEmail };
