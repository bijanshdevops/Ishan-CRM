-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "actor_id" UUID,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT,
    "caused_by_run_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_dedupe_key_key" ON "domain_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "domain_events_organization_id_occurred_at_idx" ON "domain_events"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "domain_events_dispatched_at_occurred_at_idx" ON "domain_events"("dispatched_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "domain_events"
  ADD CONSTRAINT "domain_events_payload_object_chk" CHECK (jsonb_typeof("payload") = 'object'),
  ADD CONSTRAINT "domain_events_payload_size_chk" CHECK (octet_length("payload"::text) <= 8192),
  ADD CONSTRAINT "domain_events_attempts_chk" CHECK ("attempts" >= 0);
