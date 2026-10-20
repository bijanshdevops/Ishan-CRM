-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateTable
CREATE TABLE "document_counters" (
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("organization_id","kind")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'عدد',
    "unit_price" BIGINT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID NOT NULL,
    "contact_id" UUID,
    "deal_id" UUID,
    "owner_id" UUID,
    "created_by_id" UUID,
    "issue_date" DATE NOT NULL,
    "valid_until" DATE,
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1000,
    "tax_amount" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "contract_status" NOT NULL DEFAULT 'DRAFT',
    "customer_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "terms" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "signed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_organization_id_id_idx" ON "products"("organization_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "quotes_organization_id_id_idx" ON "quotes"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "quotes_customer_id_idx" ON "quotes"("customer_id");

-- CreateIndex
CREATE INDEX "quotes_deal_id_idx" ON "quotes"("deal_id");

-- CreateIndex
CREATE INDEX "quotes_organization_id_status_idx" ON "quotes"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_org_seq_version_key" ON "quotes"("organization_id", "seq", "version");

-- CreateIndex
CREATE INDEX "quote_items_quote_id_position_idx" ON "quote_items"("quote_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_quote_id_key" ON "contracts"("quote_id");

-- CreateIndex
CREATE INDEX "contracts_organization_id_id_idx" ON "contracts"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "contracts_customer_id_idx" ON "contracts"("customer_id");

-- CreateIndex
CREATE INDEX "contracts_organization_id_status_idx" ON "contracts"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_org_seq_key" ON "contracts"("organization_id", "seq");

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data-integrity rules enforced by the database itself (Prisma does not model CHECK constraints).
ALTER TABLE "products" ADD CONSTRAINT "products_price_chk" CHECK ("unit_price" >= 0);
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_value_chk" CHECK ("value" >= 0);

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_version_chk" CHECK ("version" >= 1 AND "seq" >= 1);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "tax_amount" >= 0);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_total_chk"
  CHECK ("total" = "subtotal" - "discount" + "tax_amount");
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tax_rate_chk" CHECK ("tax_rate_bp" BETWEEN 0 AND 10000);
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_validity_chk" CHECK ("valid_until" IS NULL OR "valid_until" >= "issue_date");

ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_shape_chk"
  CHECK ("quantity" >= 1 AND "unit_price" >= 0 AND "line_total" = "quantity"::bigint * "unit_price");

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_amount_chk" CHECK ("amount" >= 0);
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dates_chk" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
