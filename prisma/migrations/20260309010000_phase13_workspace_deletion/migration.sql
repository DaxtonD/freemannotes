-- Phase 13 — Workspace deletion tombstone
--
-- Adds a persistent deletion marker so workspace deletion remains authoritative
-- across reconnects and prevents stale offline clients from reusing deleted
-- workspace metadata.

-- AlterTable
ALTER TABLE "workspace"
ADD COLUMN "deleted_at" TIMESTAMP(3);