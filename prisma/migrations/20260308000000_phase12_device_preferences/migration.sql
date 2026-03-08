-- Phase 12 — Per-device user preferences
--
-- Adds a new table for per-user + per-device preferences.
-- This keeps existing `user_preference` (e.g. delete_after_days) user-scoped.

-- CreateTable
CREATE TABLE "user_device_preference" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "theme" TEXT,
    "language" TEXT,
    "active_workspace_id" UUID,
    "checklist_show_completed" BOOLEAN NOT NULL DEFAULT false,
    "note_card_completed_expanded_by_note_id" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_device_preference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_device_preference_user_id_idx" ON "user_device_preference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_device_preference_user_id_device_id_key" ON "user_device_preference"("user_id", "device_id");

-- AddForeignKey
ALTER TABLE "user_device_preference" ADD CONSTRAINT "user_device_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
