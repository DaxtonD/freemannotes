-- Phase 17: Per-device display-size preferences.
-- These multipliers allow global typography scaling while preserving each
-- component's relative type hierarchy (headings, body, captions).

ALTER TABLE "user_device_preference"
  ADD COLUMN "note_card_font_scale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "note_editor_font_scale" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN "note_card_max_height_px" INTEGER;

ALTER TABLE "user_device_preference"
  ADD CONSTRAINT "user_device_preference_note_card_font_scale_check"
    CHECK ("note_card_font_scale" >= 0.75 AND "note_card_font_scale" <= 1.5),
  ADD CONSTRAINT "user_device_preference_note_editor_font_scale_check"
    CHECK ("note_editor_font_scale" >= 0.75 AND "note_editor_font_scale" <= 1.5),
  ADD CONSTRAINT "user_device_preference_note_card_max_height_px_check"
    CHECK ("note_card_max_height_px" IS NULL OR ("note_card_max_height_px" >= 320 AND "note_card_max_height_px" <= 1400));
