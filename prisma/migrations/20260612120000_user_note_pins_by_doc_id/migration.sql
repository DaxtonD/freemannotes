ALTER TABLE "user_preference"
ADD COLUMN "note_pins_by_doc_id" JSONB NOT NULL DEFAULT '{}';
