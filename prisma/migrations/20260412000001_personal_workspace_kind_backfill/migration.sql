-- Backfill: mark existing personal workspaces as PERSONAL system kind.
-- This must run in a separate migration (separate transaction) from the
-- ALTER TYPE that added the 'PERSONAL' enum value.  PostgreSQL error 55P04
-- prevents using a newly-added enum value in the same transaction that added it.
--
-- The initial workspace created at user registration always had the name
-- "Personal (<userId>)" (UUID pattern).  Any workspace still using that name
-- is guaranteed to be the original personal workspace for that user.
UPDATE "workspace"
SET "system_kind" = 'PERSONAL'::"WorkspaceSystemKind"
WHERE "system_kind" IS NULL
  AND "owner_user_id" IS NOT NULL
  AND "name" ~ '^Personal \([0-9a-f-]{36}\)$';
