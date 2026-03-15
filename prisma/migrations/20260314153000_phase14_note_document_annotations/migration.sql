CREATE TABLE "note_document_annotation" (
    "id" UUID NOT NULL,
    "note_document_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "annotation_type" TEXT NOT NULL,
    "quote_text" TEXT,
    "body_text" TEXT,
    "page_number" INTEGER,
    "position_json" JSONB NOT NULL,
    "color" TEXT,
    "highlight_style" TEXT,
    "background_color" TEXT,
    "font_family" TEXT,
    "font_size" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_document_annotation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_document_annotation_note_document_id_deleted_at_idx" ON "note_document_annotation"("note_document_id", "deleted_at");
CREATE INDEX "note_document_annotation_created_by_user_id_idx" ON "note_document_annotation"("created_by_user_id");

ALTER TABLE "note_document_annotation"
    ADD CONSTRAINT "note_document_annotation_note_document_id_fkey"
    FOREIGN KEY ("note_document_id") REFERENCES "note_document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_document_annotation"
    ADD CONSTRAINT "note_document_annotation_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;