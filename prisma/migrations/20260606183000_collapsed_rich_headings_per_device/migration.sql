ALTER TABLE "user_device_preference"
ADD COLUMN IF NOT EXISTS "collapsed_rich_heading_ids" JSONB NOT NULL DEFAULT '{}';