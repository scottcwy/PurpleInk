ALTER TABLE "provider_dispatches" ADD COLUMN "not_before" timestamp with time zone;
ALTER TABLE "provider_dispatches" ADD COLUMN "started_at" timestamp with time zone;
ALTER TABLE "provider_dispatches" ADD COLUMN "wait_reason" text;
ALTER TABLE "provider_dispatches" ADD COLUMN "actor_user_id" uuid;
UPDATE "provider_dispatches"
SET
  "not_before" = "reserved_at",
  "started_at" = "reserved_at",
  "status" = CASE
    WHEN "status" = 'reserved' THEN 'in_flight'
    ELSE "status"
  END;
ALTER TABLE "provider_dispatches" ALTER COLUMN "not_before" SET DEFAULT now();
ALTER TABLE "provider_dispatches" ALTER COLUMN "not_before" SET NOT NULL;
ALTER TABLE "provider_dispatches" ALTER COLUMN "status" SET DEFAULT 'scheduled';
ALTER TABLE "provider_dispatches" DROP CONSTRAINT "provider_dispatches_status_check";
ALTER TABLE "provider_dispatches" ADD CONSTRAINT "provider_dispatches_status_check"
  CHECK ("status" in ('scheduled', 'in_flight', 'released', 'cancelled'));
DROP INDEX IF EXISTS "provider_dispatches_scope_reserved_idx";
CREATE INDEX "provider_dispatches_scope_scheduled_idx"
  ON "provider_dispatches" ("scope_key", "not_before");
CREATE INDEX "provider_dispatches_scope_started_idx"
  ON "provider_dispatches" ("scope_key", "started_at");
ALTER TABLE "provider_pool_states"
  ADD COLUMN "next_dispatch_at" timestamp with time zone DEFAULT now() NOT NULL;
