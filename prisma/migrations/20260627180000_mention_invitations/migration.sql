-- AlterTable: add source + mention_excerpt to note_share_invitation
ALTER TABLE "note_share_invitation"
  ADD COLUMN "source" VARCHAR(50) NOT NULL DEFAULT 'direct',
  ADD COLUMN "mention_excerpt" TEXT;

-- AlterTable: add mention_notifications to user_preference
ALTER TABLE "user_preference"
  ADD COLUMN "mention_notifications" BOOLEAN NOT NULL DEFAULT true;
