CREATE TYPE "NoteImageAssetStatus" AS ENUM ('READY', 'DELETED');

CREATE TYPE "NoteImageOcrStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

CREATE TABLE "note_image" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_path" TEXT NOT NULL,
    "thumbnail_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "thumbnail_width" INTEGER,
    "thumbnail_height" INTEGER,
    "source_url" TEXT,
    "asset_status" "NoteImageAssetStatus" NOT NULL DEFAULT 'READY',
    "ocr_status" "NoteImageOcrStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_text" TEXT,
    "ocr_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_image_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "note_image_doc_id_deleted_at_idx" ON "note_image"("doc_id", "deleted_at");
CREATE INDEX "note_image_source_workspace_id_source_note_id_idx" ON "note_image"("source_workspace_id", "source_note_id");
CREATE INDEX "note_image_uploaded_by_user_id_idx" ON "note_image"("uploaded_by_user_id");

ALTER TABLE "note_image"
    ADD CONSTRAINT "note_image_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_image"
    ADD CONSTRAINT "note_image_source_workspace_id_fkey"
    FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_image"
    ADD CONSTRAINT "note_image_uploaded_by_user_id_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;