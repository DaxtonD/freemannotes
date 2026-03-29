-- Phase 17: Push Notification Infrastructure
--
-- Adds three tables:
--   push_subscription       – per-device VAPID / FCM tokens
--   push_notification_log   – delivery audit log
--   note_reminder           – server-side copy of note reminders for scheduling
--
-- Also adds the PushPlatform enum used by push_subscription.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('WEB', 'IOS', 'ANDROID');

-- CreateTable: push_subscription
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL DEFAULT 'WEB',
    "endpoint" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "fcm_token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable: push_notification_log
CREATE TABLE "push_notification_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "latency_ms" INTEGER,
    "error" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable: note_reminder
CREATE TABLE "note_reminder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "reminder_at" TIMESTAMP(3) NOT NULL,
    "note_title" TEXT,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "fired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "note_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_user_id_device_id_key"
    ON "push_subscription"("user_id", "device_id");

CREATE INDEX "push_subscription_user_id_idx"
    ON "push_subscription"("user_id");

CREATE INDEX "push_notification_log_user_id_idx"
    ON "push_notification_log"("user_id");

CREATE INDEX "push_notification_log_sent_at_idx"
    ON "push_notification_log"("sent_at");

CREATE UNIQUE INDEX "note_reminder_user_id_doc_id_key"
    ON "note_reminder"("user_id", "doc_id");

CREATE INDEX "note_reminder_user_id_idx"
    ON "note_reminder"("user_id");

CREATE INDEX "note_reminder_reminder_at_fired_idx"
    ON "note_reminder"("reminder_at", "fired");

-- AddForeignKey: push_subscription → user
ALTER TABLE "push_subscription"
    ADD CONSTRAINT "push_subscription_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: push_notification_log → user
ALTER TABLE "push_notification_log"
    ADD CONSTRAINT "push_notification_log_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: note_reminder → user
ALTER TABLE "note_reminder"
    ADD CONSTRAINT "note_reminder_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
