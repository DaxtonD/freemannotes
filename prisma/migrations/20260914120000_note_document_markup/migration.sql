-- PDF markup, one row per document version: the saved Yjs state of that version's
-- "markup:<versionId>" room. Deleted with its version.

-- CreateTable
CREATE TABLE "note_document_markup" (
    "version_id" UUID NOT NULL,
    "state" BYTEA NOT NULL,
    "state_vector" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_document_markup_pkey" PRIMARY KEY ("version_id")
);

-- AddForeignKey
ALTER TABLE "note_document_markup" ADD CONSTRAINT "note_document_markup_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "note_document_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
