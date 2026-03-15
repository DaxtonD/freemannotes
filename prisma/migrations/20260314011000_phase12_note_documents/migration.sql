-- CreateEnum
CREATE TYPE "NoteDocumentOcrStatus" AS ENUM ('PENDING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "note_document" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_document_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "note_document" ADD CONSTRAINT "note_document_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_document" ADD CONSTRAINT "note_document_source_workspace_id_fkey" FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_document" ADD CONSTRAINT "note_document_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "note_document_doc_id_deleted_at_idx" ON "note_document"("doc_id", "deleted_at");

-- CreateIndex
CREATE INDEX "note_document_source_workspace_id_source_note_id_idx" ON "note_document"("source_workspace_id", "source_note_id");

-- CreateIndex
CREATE INDEX "note_document_uploaded_by_user_id_idx" ON "note_document"("uploaded_by_user_id");