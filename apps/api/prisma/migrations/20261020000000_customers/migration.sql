-- CreateEnum
CREATE TYPE "customer_kind" AS ENUM ('PERSON', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" "customer_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "national_id" TEXT,
    "economic_code" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "province" TEXT,
    "city" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "owner_id" UUID,
    "created_by_id" UUID,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "search_text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tags" (
    "customer_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customer_id","tag_id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_id_idx" ON "customers"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "customers_organization_id_kind_idx" ON "customers"("organization_id", "kind");

-- CreateIndex
CREATE INDEX "customers_owner_id_idx" ON "customers"("owner_id");

-- CreateIndex
CREATE INDEX "customers_organization_id_email_idx" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "contacts_customer_id_idx" ON "contacts"("customer_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_id_idx" ON "contacts"("organization_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tags_organization_id_name_key" ON "tags"("organization_id", "name");

-- CreateIndex
CREATE INDEX "customer_tags_tag_id_idx" ON "customer_tags"("tag_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
