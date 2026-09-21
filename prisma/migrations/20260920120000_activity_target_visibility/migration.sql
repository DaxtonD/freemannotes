-- Inbox redesign: an activity can now exist before its recipient is allowed to see it.
--
-- A note share / @mention invitation lives in the notification bell until you answer it.
-- The matching Activity row still gets written the moment the mention happens (that's
-- where the prosemirror nodeId for "scroll to the chip" comes from, and we'd lose it
-- otherwise), but it must stay out of the recipient's inbox until they accept. One
-- boolean per target beats filtering on a JSON field at read time, and it keeps the
-- badge count a plain indexed COUNT instead of a fetch-then-filter-in-JS.
ALTER TABLE "activity_target" ADD COLUMN "visible" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "activity_target_user_id_visible_idx" ON "activity_target"("user_id", "visible");

-- Backfill: hide the cards that are sitting in inboxes right now attached to an
-- invitation nobody has answered. Without this they'd survive the redesign as dead
-- cards whose Accept button no longer exists.
UPDATE "activity_target" AS t
SET "visible" = false
FROM "activity" AS a, "note_share_invitation" AS i
WHERE t."activity_id" = a."id"
  AND a."snapshot" ->> 'invitationId' ~ '^[0-9a-fA-F-]{36}$'
  AND i."id" = (a."snapshot" ->> 'invitationId')::uuid
  AND i."responded_at" IS NULL
  AND i."revoked_at" IS NULL;

UPDATE "activity_target" AS t
SET "visible" = false
FROM "activity" AS a, "note_share_invitation" AS i
WHERE t."activity_id" = a."id"
  AND a."kind" = 'note_shared'
  AND i."doc_id" = a."source_doc_id"
  AND i."invitee_user_id" = t."user_id"
  AND i."responded_at" IS NULL
  AND i."revoked_at" IS NULL;
