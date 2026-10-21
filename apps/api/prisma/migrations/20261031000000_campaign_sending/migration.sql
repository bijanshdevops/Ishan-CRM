-- CreateTable
CREATE TABLE "campaign_sendings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "started_by_id" UUID,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "campaign_sendings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" UUID NOT NULL,
    "sending_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_suppressions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sendings_campaign_id_key" ON "campaign_sendings"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_sendings_organization_id_status_idx" ON "campaign_sendings"("organization_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_status_next_attempt_at_idx" ON "campaign_recipients"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "campaign_recipients_sending_id_status_idx" ON "campaign_recipients"("sending_id", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_created_at_idx" ON "campaign_recipients"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_sending_id_email_key" ON "campaign_recipients"("sending_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_suppressions_organization_id_email_key" ON "marketing_suppressions"("organization_id", "email");

-- AddForeignKey
ALTER TABLE "campaign_sendings" ADD CONSTRAINT "campaign_sendings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_sending_id_fkey" FOREIGN KEY ("sending_id") REFERENCES "campaign_sendings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "campaign_sendings"
  ADD CONSTRAINT "campaign_sendings_status_chk" CHECK ("status" IN ('DRAFT', 'SENDING', 'DONE', 'CANCELED')),
  ADD CONSTRAINT "campaign_sendings_subject_chk" CHECK (char_length("subject") BETWEEN 1 AND 200 AND "subject" !~ '[\r\n]'),
  ADD CONSTRAINT "campaign_sendings_body_chk" CHECK (char_length("body") BETWEEN 1 AND 5000),
  ADD CONSTRAINT "campaign_sendings_started_chk" CHECK (("status" = 'DRAFT') = ("started_at" IS NULL));

ALTER TABLE "campaign_recipients"
  ADD CONSTRAINT "campaign_recipients_status_chk" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  ADD CONSTRAINT "campaign_recipients_attempt_chk" CHECK ("attempt" BETWEEN 0 AND 5),
  ADD CONSTRAINT "campaign_recipients_pending_chk" CHECK (("status" = 'PENDING') = ("next_attempt_at" IS NOT NULL)),
  ADD CONSTRAINT "campaign_recipients_sent_chk" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
  ADD CONSTRAINT "campaign_recipients_email_chk" CHECK ("email" = lower("email") AND char_length("email") <= 254),
  ADD CONSTRAINT "campaign_recipients_error_chk" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500);

ALTER TABLE "marketing_suppressions"
  ADD CONSTRAINT "marketing_suppressions_reason_chk" CHECK ("reason" IN ('UNSUBSCRIBED', 'BOUNCED', 'MANUAL')),
  ADD CONSTRAINT "marketing_suppressions_email_chk" CHECK ("email" = lower("email") AND char_length("email") <= 254);
