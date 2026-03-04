-- Fix drift between the Phase 10 baseline migration and the current dev DB.
-- This is intentionally minimal and non-destructive.

BEGIN;

-- Ensure gen_random_uuid() exists.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- UUID defaults.
ALTER TABLE IF EXISTS public.workspace
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE IF EXISTS public.document
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE IF EXISTS public.user_preference
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Timestamp types (baseline expects TIMESTAMPTZ).
ALTER TABLE IF EXISTS public.workspace
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE IF EXISTS public.document
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE IF EXISTS public.user_preference
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- Remove leftover composite-unique index from the pre-Phase-10 schema.
-- Phase 10 expects doc_id to be globally unique via document_doc_id_key.
DROP INDEX IF EXISTS public.yjs_document_workspace_id_doc_id_key;

COMMIT;
