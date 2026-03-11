CREATE TYPE "WorkspaceRole_new" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

ALTER TABLE "workspace_member"
ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "invite_token"
ALTER COLUMN "role" TYPE "WorkspaceRole_new"
USING (
	CASE
		WHEN "role"::text = 'OWNER' THEN 'OWNER'::"WorkspaceRole_new"
		WHEN "role"::text = 'EDITOR' THEN 'EDITOR'::"WorkspaceRole_new"
		ELSE 'VIEWER'::"WorkspaceRole_new"
	END
);

ALTER TABLE "share_token"
ALTER COLUMN "role" TYPE "WorkspaceRole_new"
USING (
	CASE
		WHEN "role"::text = 'OWNER' THEN 'OWNER'::"WorkspaceRole_new"
		WHEN "role"::text = 'EDITOR' THEN 'EDITOR'::"WorkspaceRole_new"
		ELSE 'VIEWER'::"WorkspaceRole_new"
	END
);

ALTER TABLE "workspace_member"
ALTER COLUMN "role" TYPE "WorkspaceRole_new"
USING (
	CASE
		WHEN "role"::text = 'OWNER' THEN 'OWNER'::"WorkspaceRole_new"
		WHEN "role"::text = 'EDITOR' THEN 'EDITOR'::"WorkspaceRole_new"
		ELSE 'VIEWER'::"WorkspaceRole_new"
	END
);

DROP TYPE "WorkspaceRole";
ALTER TYPE "WorkspaceRole_new" RENAME TO "WorkspaceRole";

ALTER TABLE "workspace_member"
ALTER COLUMN "role" SET DEFAULT 'VIEWER';

DO $$
BEGIN
	IF to_regclass('public.share_access_token') IS NOT NULL
		AND EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ShareAccessPermission')
	THEN
		CREATE TYPE "ShareAccessPermission_new" AS ENUM ('VIEWER', 'EDITOR');

		ALTER TABLE "share_access_token"
		ALTER COLUMN "permission" TYPE "ShareAccessPermission_new"
		USING (
			CASE
				WHEN "permission"::text = 'EDITOR' THEN 'EDITOR'::"ShareAccessPermission_new"
				ELSE 'VIEWER'::"ShareAccessPermission_new"
			END
		);

		DROP TYPE "ShareAccessPermission";
		ALTER TYPE "ShareAccessPermission_new" RENAME TO "ShareAccessPermission";
	END IF;
END $$;