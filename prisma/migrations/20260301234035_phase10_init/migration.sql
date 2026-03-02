-- Phase 10 – Initial migration (baseline)
--
-- This migration creates all tables from scratch for the Phase 10 schema.
-- For existing databases that were previously managed with `prisma db push`,
-- mark this migration as already applied:
--   npx prisma migrate resolve --applied 20260301234035_phase10_init
--
-- Tables:
--   workspace        – lightweight tenant boundary
--   document         – persisted Yjs document state (binary snapshot)
--   user_preference  – per-user configurable settings

-- ── Workspace ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "workspace" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "name"           TEXT         NOT NULL DEFAULT 'default',
    "owner_user_id"  TEXT,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workspace_name_key"
    ON "workspace"("name");

-- ── Document ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "document" (
    "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"   UUID         NOT NULL,
    "doc_id"         TEXT         NOT NULL,
    "state"          BYTEA        NOT NULL,
    "state_vector"   BYTEA        NOT NULL,
    "created_at"     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_doc_id_key"
    ON "document"("doc_id");

CREATE INDEX IF NOT EXISTS "document_workspace_id_idx"
    ON "document"("workspace_id");

ALTER TABLE "document"
    ADD CONSTRAINT "document_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── User Preference ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "user_preference" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "user_id"          TEXT         NOT NULL,
    "delete_after_days" INTEGER     NOT NULL DEFAULT 30,
    "created_at"       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "user_preference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_preference_user_id_key"
    ON "user_preference"("user_id");
