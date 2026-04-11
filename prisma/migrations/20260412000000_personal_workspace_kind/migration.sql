-- Add PERSONAL system kind to identify the user's initial private workspace.
-- This workspace is pinned as non-shareable (groundwork for future per-workspace encryption).
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that references the new value (PostgreSQL error 55P04).
-- The backfill UPDATE is therefore in the next migration:
-- 20260412000001_personal_workspace_kind_backfill

-- AlterEnum: add PERSONAL value to WorkspaceSystemKind
ALTER TYPE "WorkspaceSystemKind" ADD VALUE IF NOT EXISTS 'PERSONAL';
