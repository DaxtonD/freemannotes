ALTER TABLE "user_device_preference"
ADD COLUMN "note_card_checkbox_interactions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "note_card_link_interactions" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "note_card_completed_interactions" BOOLEAN NOT NULL DEFAULT true;

UPDATE "user_device_preference"
SET
  "note_card_checkbox_interactions" = COALESCE("note_card_click_opens", true),
  "note_card_link_interactions" = COALESCE("note_card_click_opens", true),
  "note_card_completed_interactions" = COALESCE("note_card_click_opens", true);