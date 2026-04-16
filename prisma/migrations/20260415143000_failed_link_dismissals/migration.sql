ALTER TABLE "user_preference"
ADD COLUMN IF NOT EXISTS "dismissed_failed_link_ids" JSONB NOT NULL DEFAULT '{}';