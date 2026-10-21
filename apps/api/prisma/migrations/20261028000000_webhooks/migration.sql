-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event_types" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabled_reason" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "secret_ciphertext" TEXT NOT NULL,
    "secret_hint" TEXT NOT NULL,
    "previous_secret_ciphertext" TEXT,
    "previous_secret_expires_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "response_snippet" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_endpoints_organization_id_id_idx" ON "webhook_endpoints"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_id_idx" ON "webhook_deliveries"("endpoint_id", "id" DESC);

-- CreateIndex
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_event_id_key" ON "webhook_deliveries"("endpoint_id", "event_id");

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_name_chk" CHECK (char_length("name") BETWEEN 2 AND 120),
  ADD CONSTRAINT "webhook_endpoints_url_chk" CHECK (char_length("url") <= 2048 AND "url" ~ '^https?://'),
  ADD CONSTRAINT "webhook_endpoints_event_types_chk" CHECK (
    cardinality("event_types") >= 1
    AND "event_types" <@ ARRAY['lead.created', 'lead.converted', 'deal.created', 'deal.stage_changed',
      'quote.accepted', 'quote.rejected', 'activity.overdue', 'contract.expiring']::TEXT[]),
  ADD CONSTRAINT "webhook_endpoints_disabled_reason_chk" CHECK (
    "disabled_reason" IS NULL OR "disabled_reason" IN ('MANUAL', 'AUTO_FAILURES')),
  ADD CONSTRAINT "webhook_endpoints_failures_chk" CHECK ("consecutive_failures" >= 0),
  ADD CONSTRAINT "webhook_endpoints_secret_hint_chk" CHECK (char_length("secret_hint") = 4),
  ADD CONSTRAINT "webhook_endpoints_previous_secret_chk" CHECK (
    ("previous_secret_ciphertext" IS NULL) = ("previous_secret_expires_at" IS NULL));

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_status_chk" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  ADD CONSTRAINT "webhook_deliveries_attempt_chk" CHECK ("attempt" BETWEEN 0 AND 7),
  ADD CONSTRAINT "webhook_deliveries_payload_chk" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "webhook_deliveries_error_chk" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500),
  ADD CONSTRAINT "webhook_deliveries_snippet_chk" CHECK ("response_snippet" IS NULL OR char_length("response_snippet") <= 500),
  ADD CONSTRAINT "webhook_deliveries_pending_chk" CHECK (("status" = 'PENDING') = ("next_attempt_at" IS NOT NULL));
