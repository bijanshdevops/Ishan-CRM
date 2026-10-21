-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_deliveries_notification_id_key" ON "email_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "email_deliveries_status_next_attempt_at_idx" ON "email_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_deliveries_user_id_created_at_idx" ON "email_deliveries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "email_deliveries_created_at_idx" ON "email_deliveries"("created_at");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_status_chk" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  ADD CONSTRAINT "email_deliveries_attempt_chk" CHECK ("attempt" BETWEEN 0 AND 5),
  ADD CONSTRAINT "email_deliveries_pending_chk" CHECK (("status" = 'PENDING') = ("next_attempt_at" IS NOT NULL)),
  ADD CONSTRAINT "email_deliveries_sent_chk" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
  ADD CONSTRAINT "email_deliveries_error_chk" CHECK ("last_error" IS NULL OR char_length("last_error") <= 500);
