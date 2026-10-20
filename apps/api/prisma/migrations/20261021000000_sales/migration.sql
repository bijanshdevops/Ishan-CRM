-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "stage_kind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "owner_id" UUID,
    "created_by_id" UUID,
    "notes" TEXT,
    "disqualify_reason" TEXT,
    "converted_at" TIMESTAMPTZ(6),
    "converted_customer_id" UUID,
    "converted_deal_id" UUID,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL DEFAULT 0,
    "kind" "stage_kind" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "stage_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL DEFAULT 0,
    "expected_close_date" DATE,
    "owner_id" UUID,
    "created_by_id" UUID,
    "notes" TEXT,
    "lost_reason" TEXT,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stage_events" (
    "id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_organization_id_id_idx" ON "leads"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "leads_organization_id_status_idx" ON "leads"("organization_id", "status");

-- CreateIndex
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");

-- CreateIndex
CREATE INDEX "pipeline_stages_organization_id_position_idx" ON "pipeline_stages"("organization_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_organization_id_name_key" ON "pipeline_stages"("organization_id", "name");

-- CreateIndex
CREATE INDEX "deals_organization_id_id_idx" ON "deals"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "deals_organization_id_stage_id_idx" ON "deals"("organization_id", "stage_id");

-- CreateIndex
CREATE INDEX "deals_customer_id_idx" ON "deals"("customer_id");

-- CreateIndex
CREATE INDEX "deals_owner_id_idx" ON "deals"("owner_id");

-- CreateIndex
CREATE INDEX "deal_stage_events_deal_id_idx" ON "deal_stage_events"("deal_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_customer_id_fkey" FOREIGN KEY ("converted_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stage_events" ADD CONSTRAINT "deal_stage_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
