/*
  Warnings:

  - The `user_id` column on the `user_preference` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "document" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_preference" ADD COLUMN     "language" TEXT,
ADD COLUMN     "theme" TEXT,
ALTER COLUMN "id" DROP DEFAULT,
DROP COLUMN "user_id",
ADD COLUMN     "user_id" UUID,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "workspace" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "GlobalRole" NOT NULL DEFAULT 'USER',
    "profile_image" TEXT,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_member" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "workspace_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_token" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invite_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_token" (
    "id" UUID NOT NULL,
    "doc_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "role" "WorkspaceRole" NOT NULL,

    CONSTRAINT "share_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "workspace_member_workspace_id_idx" ON "workspace_member"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_member_user_id_workspace_id_key" ON "workspace_member"("user_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_token_token_key" ON "invite_token"("token");

-- CreateIndex
CREATE INDEX "invite_token_workspace_id_idx" ON "invite_token"("workspace_id");

-- CreateIndex
CREATE INDEX "invite_token_email_idx" ON "invite_token"("email");

-- CreateIndex
CREATE UNIQUE INDEX "share_token_token_key" ON "share_token"("token");

-- CreateIndex
CREATE INDEX "share_token_doc_id_idx" ON "share_token"("doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_preference_user_id_key" ON "user_preference"("user_id");

-- AddForeignKey
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_token" ADD CONSTRAINT "invite_token_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_token" ADD CONSTRAINT "share_token_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "document"("doc_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
