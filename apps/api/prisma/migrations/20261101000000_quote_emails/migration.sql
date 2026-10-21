-- CreateTable
CREATE TABLE "quote_emails" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "sender_id" UUID,
    "to_email" TEXT NOT NULL,
    "reply_to" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_emails_quote_id_created_at_idx" ON "quote_emails"("quote_id", "created_at");

-- CreateIndex
CREATE INDEX "quote_emails_status_next_attempt_at_idx" ON "quote_emails"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "quote_emails_sender_id_created_at_idx" ON "quote_emails"("sender_id", "created_at");

-- AddForeignKey
ALTER TABLE "quote_emails" ADD CONSTRAINT "quote_emails_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_emails" ADD CONSTRAINT "quote_emails_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "quote_emails"
  ADD CONSTRAINT "quote_emails_status_chk" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
  ADD CONSTRAINT "quote_emails_attempt_chk" CHECK ("attempt" BETWEEN 0 AND 5),
  ADD CONSTRAINT "quote_emails_pending_chk" CHECK (("status" = 'PENDING') = ("next_attempt_at" IS NOT NULL)),
  ADD CONSTRAINT "quote_emails_sent_chk" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
  ADD CONSTRAINT "quote_emails_to_chk" CHECK ("to_email" = lower("to_email") AND char_length("to_email") <= 254),
  ADD CONSTRAINT "quote_emails_message_chk" CHECK ("message" IS NULL OR char_length("message") <= 2000),
  ADD CONSTRAINT "quote_emails_error_chk" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500);
