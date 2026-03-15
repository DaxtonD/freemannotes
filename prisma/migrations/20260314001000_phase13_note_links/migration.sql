CREATE TYPE "NoteLinkStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "note_link" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "normalized_url" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "root_domain" TEXT NOT NULL,
    "site_name" TEXT,
    "title" TEXT,
    "description" TEXT,
    "main_content" TEXT,
    "image_url" TEXT,
    "metadata_json" JSONB,
    "image_urls" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "NoteLinkStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_link_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "note_link_doc_id_normalized_url_key" ON "note_link"("doc_id", "normalized_url");
CREATE INDEX "note_link_doc_id_deleted_at_idx" ON "note_link"("doc_id", "deleted_at");
CREATE INDEX "note_link_source_workspace_id_source_note_id_idx" ON "note_link"("source_workspace_id", "source_note_id");
CREATE INDEX "note_link_created_by_user_id_idx" ON "note_link"("created_by_user_id");

ALTER TABLE "note_link"
    ADD CONSTRAINT "note_link_doc_id_fkey"
    FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_link"
    ADD CONSTRAINT "note_link_source_workspace_id_fkey"
    FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "note_link"
    ADD CONSTRAINT "note_link_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;