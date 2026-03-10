-- Phase 15 — Note collaboration invitations, placements, and system shared workspaces

-- CreateEnum
CREATE TYPE "WorkspaceSystemKind" AS ENUM ('SHARED_WITH_ME');

-- CreateEnum
CREATE TYPE "NoteShareRole" AS ENUM ('VIEWER', 'EDITOR');

-- CreateEnum
CREATE TYPE "NoteShareStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- AlterTable
ALTER TABLE "workspace"
ADD COLUMN "system_kind" "WorkspaceSystemKind";

-- CreateIndex
CREATE UNIQUE INDEX "workspace_system_kind_owner_user_id_key" ON "workspace"("system_kind", "owner_user_id");

-- CreateTable
CREATE TABLE "note_share_invitation" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "inviter_user_id" UUID NOT NULL,
    "invitee_user_id" UUID,
    "invitee_email" TEXT NOT NULL,
    "invitee_name" TEXT,
    "role" "NoteShareRole" NOT NULL,
    "status" "NoteShareStatus" NOT NULL DEFAULT 'PENDING',
    "responded_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_share_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_collaborator" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "source_workspace_id" UUID NOT NULL,
    "source_note_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "invitation_id" UUID,
    "role" "NoteShareRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "note_collaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note_share_placement" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "collaborator_id" UUID NOT NULL,
    "target_workspace_id" UUID NOT NULL,
    "folder_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "note_share_placement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "note_share_invitation_invitee_email_idx" ON "note_share_invitation"("invitee_email");

-- CreateIndex
CREATE INDEX "note_share_invitation_invitee_user_id_idx" ON "note_share_invitation"("invitee_user_id");

-- CreateIndex
CREATE INDEX "note_share_invitation_source_workspace_id_idx" ON "note_share_invitation"("source_workspace_id");

-- CreateIndex
CREATE INDEX "note_share_invitation_doc_id_idx" ON "note_share_invitation"("doc_id");

-- CreateIndex
CREATE INDEX "note_share_invitation_status_idx" ON "note_share_invitation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "note_collaborator_invitation_id_key" ON "note_collaborator"("invitation_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_collaborator_doc_id_user_id_key" ON "note_collaborator"("doc_id", "user_id");

-- CreateIndex
CREATE INDEX "note_collaborator_user_id_idx" ON "note_collaborator"("user_id");

-- CreateIndex
CREATE INDEX "note_collaborator_source_workspace_id_idx" ON "note_collaborator"("source_workspace_id");

-- CreateIndex
CREATE INDEX "note_collaborator_doc_id_idx" ON "note_collaborator"("doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_share_placement_invitation_id_key" ON "note_share_placement"("invitation_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_share_placement_collaborator_id_key" ON "note_share_placement"("collaborator_id");

-- CreateIndex
CREATE UNIQUE INDEX "note_share_placement_user_id_collaborator_id_key" ON "note_share_placement"("user_id", "collaborator_id");

-- CreateIndex
CREATE INDEX "note_share_placement_user_id_idx" ON "note_share_placement"("user_id");

-- CreateIndex
CREATE INDEX "note_share_placement_target_workspace_id_idx" ON "note_share_placement"("target_workspace_id");

-- AddForeignKey
ALTER TABLE "note_share_invitation" ADD CONSTRAINT "note_share_invitation_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_invitation" ADD CONSTRAINT "note_share_invitation_source_workspace_id_fkey" FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_invitation" ADD CONSTRAINT "note_share_invitation_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_invitation" ADD CONSTRAINT "note_share_invitation_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_collaborator" ADD CONSTRAINT "note_collaborator_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_collaborator" ADD CONSTRAINT "note_collaborator_source_workspace_id_fkey" FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_collaborator" ADD CONSTRAINT "note_collaborator_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_collaborator" ADD CONSTRAINT "note_collaborator_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "note_share_invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_placement" ADD CONSTRAINT "note_share_placement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_placement" ADD CONSTRAINT "note_share_placement_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "note_share_invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_placement" ADD CONSTRAINT "note_share_placement_collaborator_id_fkey" FOREIGN KEY ("collaborator_id") REFERENCES "note_collaborator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note_share_placement" ADD CONSTRAINT "note_share_placement_target_workspace_id_fkey" FOREIGN KEY ("target_workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;