-- Documents get versions.
--
-- A note document used to be one row holding one file. Replacing a file meant a second
-- copy, and "which blueprint is current?" had no good answer. Now note_document is the
-- item on the note and note_document_version holds each uploaded file.
--
-- Order matters: build the version table and copy any existing documents into it as
-- version 1 BEFORE dropping the old file columns. Files on disk don't move; the upload
-- access check still finds version-1 files under their old folder.
--
-- Also drops note_document_annotation, which nothing ever read or wrote (markup was only
-- ever saved on the device that drew it). Markup comes back later as synced Yjs data.

-- CreateEnum
CREATE TYPE "NoteDocumentConversionStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "note_document_version" (
    "id" UUID NOT NULL,
    "note_document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "original_path" TEXT NOT NULL,
    "preview_path" TEXT NOT NULL,
    "thumbnail_path" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "page_count" INTEGER,
    "preview_width" INTEGER,
    "preview_height" INTEGER,
    "thumbnail_width" INTEGER,
    "thumbnail_height" INTEGER,
    "ocr_status" "NoteDocumentOcrStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_text" TEXT,
    "ocr_error" TEXT,
    "conversion_status" "NoteDocumentConversionStatus" NOT NULL DEFAULT 'NOT_NEEDED',
    "view_pdf_path" TEXT,
    "conversion_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_document_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_document_version_note_document_id_deleted_at_idx" ON "note_document_version"("note_document_id", "deleted_at");

-- CreateIndex
CREATE INDEX "note_document_version_uploaded_by_user_id_idx" ON "note_document_version"("uploaded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_document_version_note_document_id_version_number_key" ON "note_document_version"("note_document_id", "version_number");

-- AddForeignKey
ALTER TABLE "note_document_version" ADD CONSTRAINT "note_document_version_note_document_id_fkey" FOREIGN KEY ("note_document_id") REFERENCES "note_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_document_version" ADD CONSTRAINT "note_document_version_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing documents over as version 1 (keeps their soft-delete state too).
INSERT INTO "note_document_version" (
    "id",
    "note_document_id",
    "version_number",
    "uploaded_by_user_id",
    "original_path",
    "preview_path",
    "thumbnail_path",
    "file_name",
    "file_extension",
    "mime_type",
    "byte_size",
    "page_count",
    "preview_width",
    "preview_height",
    "thumbnail_width",
    "thumbnail_height",
    "ocr_status",
    "ocr_text",
    "ocr_error",
    "created_at",
    "deleted_at"
)
SELECT
    gen_random_uuid(),
    "id",
    1,
    "uploaded_by_user_id",
    "original_path",
    "preview_path",
    "thumbnail_path",
    "file_name",
    "file_extension",
    "mime_type",
    "byte_size",
    "page_count",
    "preview_width",
    "preview_height",
    "thumbnail_width",
    "thumbnail_height",
    "ocr_status",
    "ocr_text",
    "ocr_error",
    "created_at",
    "deleted_at"
FROM "note_document";

-- AlterTable
ALTER TABLE "note_document" ADD COLUMN "latest_version_number" INTEGER NOT NULL DEFAULT 0;

UPDATE "note_document" SET "latest_version_number" = 1;

-- DropForeignKey
ALTER TABLE "note_document_annotation" DROP CONSTRAINT IF EXISTS "note_document_annotation_note_document_id_fkey";

-- DropForeignKey
ALTER TABLE "note_document_annotation" DROP CONSTRAINT IF EXISTS "note_document_annotation_created_by_user_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "note_document_annotation";

-- AlterTable
ALTER TABLE "note_document" DROP COLUMN "byte_size",
DROP COLUMN "file_extension",
DROP COLUMN "file_name",
DROP COLUMN "mime_type",
DROP COLUMN "ocr_error",
DROP COLUMN "ocr_status",
DROP COLUMN "ocr_text",
DROP COLUMN "original_path",
DROP COLUMN "page_count",
DROP COLUMN "preview_height",
DROP COLUMN "preview_path",
DROP COLUMN "preview_width",
DROP COLUMN "storage_key",
DROP COLUMN "thumbnail_height",
DROP COLUMN "thumbnail_path",
DROP COLUMN "thumbnail_width";
