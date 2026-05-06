ALTER TABLE "note_share_placement"
ADD COLUMN "collection_id" TEXT,
ADD COLUMN "label_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;
