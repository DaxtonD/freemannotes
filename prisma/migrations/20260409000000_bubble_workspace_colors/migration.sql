-- AddColumn: bubble_workspace_colors to user_preference
-- Per-user workspace bubble color overrides for bubble view.
-- Stored as JSONB: { [workspaceId: string]: NoteColorToken }

ALTER TABLE "user_preference"
ADD COLUMN IF NOT EXISTS "bubble_workspace_colors" JSONB NOT NULL DEFAULT '{}';
