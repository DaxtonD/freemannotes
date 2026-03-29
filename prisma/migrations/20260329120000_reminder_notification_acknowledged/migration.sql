-- AlterTable: add notification_acknowledged_at to note_reminder
-- This column tracks when the user's in-app notification bell was
-- cleared for a given fired reminder. Rows with fired=true and
-- notification_acknowledged_at IS NULL count towards the bell badge.
ALTER TABLE "note_reminder" ADD COLUMN "notification_acknowledged_at" TIMESTAMP(3);
