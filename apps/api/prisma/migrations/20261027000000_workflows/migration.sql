-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,
    "steps" JSONB NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflows_organization_id_trigger_type_enabled_idx" ON "workflows"("organization_id", "trigger_type", "enabled");

-- CreateIndex
CREATE INDEX "workflows_organization_id_id_idx" ON "workflows"("organization_id", "id" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_id_id_idx" ON "workflow_runs"("workflow_id", "id" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_workflow_id_event_id_key" ON "workflow_runs"("workflow_id", "event_id");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants the application must never be able to break.
ALTER TABLE "workflows"
  ADD CONSTRAINT "workflows_name_chk" CHECK (char_length("name") BETWEEN 2 AND 120),
  ADD CONSTRAINT "workflows_description_chk" CHECK ("description" IS NULL OR char_length("description") <= 500),
  ADD CONSTRAINT "workflows_trigger_chk" CHECK ("trigger_type" IN (
    'lead.created', 'lead.converted', 'deal.created', 'deal.stage_changed',
    'quote.accepted', 'quote.rejected', 'activity.overdue', 'contract.expiring')),
  ADD CONSTRAINT "workflows_conditions_chk" CHECK (jsonb_typeof("conditions") = 'array' AND jsonb_array_length("conditions") <= 10),
  ADD CONSTRAINT "workflows_actions_chk" CHECK (jsonb_typeof("actions") = 'array' AND jsonb_array_length("actions") BETWEEN 1 AND 10);

ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_status_chk" CHECK ("status" IN ('SUCCEEDED', 'FAILED')),
  ADD CONSTRAINT "workflow_runs_steps_chk" CHECK (jsonb_typeof("steps") = 'array'),
  ADD CONSTRAINT "workflow_runs_error_chk" CHECK ("error" IS NULL OR char_length("error") <= 500);
