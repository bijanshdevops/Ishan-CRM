-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entity_type" TEXT,
    "entity_id" UUID,
    "workflow_run_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_id_idx" ON "notifications"("user_id", "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_read_at_idx" ON "notifications"("read_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_type_chk" CHECK ("type" IN ('workflow', 'system')),
  ADD CONSTRAINT "notifications_title_chk" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "notifications_body_chk" CHECK ("body" IS NULL OR char_length("body") <= 1000),
  ADD CONSTRAINT "notifications_entity_chk" CHECK (("entity_type" IS NULL) = ("entity_id" IS NULL));
