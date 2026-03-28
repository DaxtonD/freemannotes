-- Phase 17 follow-up: add per-device note card max height for databases that
-- already applied the original display-size migration before this column was
-- included.

ALTER TABLE "user_device_preference"
  ADD COLUMN IF NOT EXISTS "note_card_max_height_px" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_device_preference_note_card_max_height_px_check'
  ) THEN
    ALTER TABLE "user_device_preference"
      ADD CONSTRAINT "user_device_preference_note_card_max_height_px_check"
      CHECK (
        "note_card_max_height_px" IS NULL
        OR (
          "note_card_max_height_px" >= 320
          AND "note_card_max_height_px" <= 1400
        )
      );
  END IF;
END
$$;