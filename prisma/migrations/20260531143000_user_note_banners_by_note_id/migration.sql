ALTER TABLE "user_preference"
ADD COLUMN "note_banners_by_note_id" JSONB NOT NULL DEFAULT '{}';