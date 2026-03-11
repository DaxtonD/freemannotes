-- Phase 16 — Secure share links, workspace editor role, and richer invite metadata

ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'EDITOR';

CREATE TYPE "ShareAccessEntityType" AS ENUM ('NOTE', 'WORKSPACE');

CREATE TYPE "ShareAccessPermission" AS ENUM ('VIEWER', 'EDITOR', 'MEMBER', 'ADMIN');

ALTER TABLE "invite_token"
ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "created_by_user_id" UUID;

CREATE TABLE "share_access_token" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "entity_type" "ShareAccessEntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "source_workspace_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "permission" "ShareAccessPermission" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_access_token_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "share_access_token_token_key" ON "share_access_token"("token");
CREATE INDEX "share_access_token_entity_type_entity_id_idx" ON "share_access_token"("entity_type", "entity_id");
CREATE INDEX "share_access_token_source_workspace_id_idx" ON "share_access_token"("source_workspace_id");
CREATE INDEX "share_access_token_created_by_user_id_idx" ON "share_access_token"("created_by_user_id");

ALTER TABLE "invite_token" ADD CONSTRAINT "invite_token_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "share_access_token" ADD CONSTRAINT "share_access_token_source_workspace_id_fkey" FOREIGN KEY ("source_workspace_id") REFERENCES "workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "share_access_token" ADD CONSTRAINT "share_access_token_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;