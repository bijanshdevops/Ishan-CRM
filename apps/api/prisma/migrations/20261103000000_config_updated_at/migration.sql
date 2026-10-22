-- AlterTable: updated_at so tags, lead sources and pipeline stages can carry an ETag (ADR 0009).
-- Existing rows start at their creation time; Prisma's @updatedAt maintains it from then on.
ALTER TABLE "tags" ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "tags" SET "updated_at" = "created_at";
ALTER TABLE "tags" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "lead_sources" ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "lead_sources" SET "updated_at" = "created_at";
ALTER TABLE "lead_sources" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "pipeline_stages" ADD COLUMN "updated_at" TIMESTAMPTZ(6);
UPDATE "pipeline_stages" SET "updated_at" = "created_at";
ALTER TABLE "pipeline_stages" ALTER COLUMN "updated_at" SET NOT NULL;
