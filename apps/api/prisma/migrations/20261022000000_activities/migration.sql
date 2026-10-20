-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('CALL', 'MEETING', 'TASK', 'NOTE');

-- CreateEnum
CREATE TYPE "activity_status" AS ENUM ('PLANNED', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "activity_priority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "status" "activity_status" NOT NULL DEFAULT 'PLANNED',
    "priority" "activity_priority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "end_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "outcome" TEXT,
    "remind_at" TIMESTAMPTZ(6),
    "reminder_dismissed_at" TIMESTAMPTZ(6),
    "assignee_id" UUID,
    "created_by_id" UUID,
    "customer_id" UUID,
    "contact_id" UUID,
    "deal_id" UUID,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_organization_id_id_idx" ON "activities"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "activities_org_assignee_status_due_idx" ON "activities"("organization_id", "assignee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "activities_org_due_idx" ON "activities"("organization_id", "due_at");

-- CreateIndex
CREATE INDEX "activities_customer_completed_idx" ON "activities"("customer_id", "completed_at" DESC);

-- CreateIndex
CREATE INDEX "activities_deal_id_idx" ON "activities"("deal_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data-integrity rules enforced by the database itself (Prisma does not model CHECK constraints).
-- Notes are always recorded and carry no schedule.
ALTER TABLE "activities" ADD CONSTRAINT "activities_note_shape_chk"
  CHECK ("type" <> 'NOTE' OR ("status" = 'DONE' AND "due_at" IS NULL AND "end_at" IS NULL AND "remind_at" IS NULL));

-- Planned work must say when it is due; finished work must say when it happened.
ALTER TABLE "activities" ADD CONSTRAINT "activities_planned_due_chk"
  CHECK ("status" <> 'PLANNED' OR "due_at" IS NOT NULL);
ALTER TABLE "activities" ADD CONSTRAINT "activities_done_completed_chk"
  CHECK ("status" <> 'DONE' OR "completed_at" IS NOT NULL);

-- A meeting/call cannot end before it starts.
ALTER TABLE "activities" ADD CONSTRAINT "activities_end_after_start_chk"
  CHECK ("end_at" IS NULL OR ("due_at" IS NOT NULL AND "end_at" >= "due_at"));
