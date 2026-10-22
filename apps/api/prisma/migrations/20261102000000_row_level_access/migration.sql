-- AlterTable: every existing role keeps seeing everything until an admin narrows it (ADR 0017).
ALTER TABLE "roles" ADD COLUMN "data_scope" TEXT NOT NULL DEFAULT 'ALL';

-- Invariants the application must never be able to break.
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_data_scope_chk" CHECK ("data_scope" IN ('ALL', 'TEAM', 'OWN')),
  ADD CONSTRAINT "roles_admin_scope_chk" CHECK ("key" <> 'admin' OR "data_scope" = 'ALL');
