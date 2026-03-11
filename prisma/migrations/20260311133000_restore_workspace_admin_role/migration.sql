-- Restore workspace ADMIN as a first-class role after the temporary
-- Owner/Editor/Viewer-only refactor.

ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'ADMIN';

ALTER TYPE "ShareAccessPermission" ADD VALUE IF NOT EXISTS 'ADMIN';