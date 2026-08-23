ALTER TABLE "user_preference"
ADD COLUMN IF NOT EXISTS "dismissed_share_invitation_ids" JSONB NOT NULL DEFAULT '{}';
