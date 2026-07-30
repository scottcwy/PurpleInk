ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "execution_epoch" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "pipeline_runs"
  ADD COLUMN IF NOT EXISTS "execution_epoch" bigint DEFAULT 0 NOT NULL;
ALTER TABLE "task_attempts"
  ADD COLUMN IF NOT EXISTS "work_unit_key" text;
ALTER TABLE "task_attempts"
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp with time zone;

UPDATE "task_attempts" AS attempt
SET "work_unit_key" = node."data"->'payload'->>'laneKey'
FROM "canvas_nodes" AS node
WHERE attempt."workspace_id" = node."workspace_id"
  AND attempt."entity_type" = 'node'
  AND attempt."entity_id" = node."id"
  AND attempt."work_unit_key" IS NULL
  AND length(node."data"->'payload'->>'laneKey') > 0;

ALTER TABLE "workflow_concurrency_leases"
  DROP CONSTRAINT IF EXISTS "workflow_concurrency_leases_pkey";
ALTER TABLE "workflow_concurrency_leases"
  ADD CONSTRAINT "workflow_concurrency_leases_pkey"
  PRIMARY KEY ("workspace_id", "project_id", "work_unit_key");

ALTER TABLE "projects"
  DROP CONSTRAINT IF EXISTS "projects_execution_epoch_check";
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_execution_epoch_check"
  CHECK ("execution_epoch" >= 0);
ALTER TABLE "pipeline_runs"
  DROP CONSTRAINT IF EXISTS "pipeline_runs_execution_epoch_check";
ALTER TABLE "pipeline_runs"
  ADD CONSTRAINT "pipeline_runs_execution_epoch_check"
  CHECK ("execution_epoch" >= 0);

CREATE INDEX IF NOT EXISTS "pipeline_runs_project_epoch_status_idx"
  ON "pipeline_runs" ("workspace_id", "project_id", "execution_epoch", "status");
CREATE INDEX IF NOT EXISTS "task_attempts_queue_lane_idx"
  ON "task_attempts" ("workspace_id", "status", "visible_at", "work_unit_key", "created_at");
