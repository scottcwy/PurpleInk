CREATE TABLE "telemetry_cutovers" (
	"key" text PRIMARY KEY NOT NULL,
	"cutover_at" timestamp with time zone NOT NULL,
	CONSTRAINT "telemetry_cutovers_key_check" CHECK ("telemetry_cutovers"."key" in ('ai_invocation_v2'))
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" DROP CONSTRAINT "ai_invocations_input_hash_check";--> statement-breakpoint
ALTER TABLE "ai_invocations" DROP CONSTRAINT "ai_invocations_billing_status_check";--> statement-breakpoint
ALTER TABLE "ai_invocations" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ALTER COLUMN "attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ALTER COLUMN "input_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "funding" text DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "capability" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "operation" text DEFAULT 'workflow' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "source" text DEFAULT 'products' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "telemetry_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "provider_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "provider_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "provider_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "failure_kind" text;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "requested_by_user_id" uuid;--> statement-breakpoint
UPDATE "ai_invocations"
SET
	"funding" = 'managed',
	"telemetry_version" = 1,
	"capability" = CASE COALESCE("usage"->>'capability', "usage"->>'kind')
		WHEN 'text' THEN 'text'
		WHEN 'vision' THEN 'vision'
		WHEN 'tts' THEN 'tts'
		WHEN 'asr' THEN 'asr'
		ELSE NULL
	END;--> statement-breakpoint
INSERT INTO "telemetry_cutovers" ("key", "cutover_at")
VALUES ('ai_invocation_v2', now());--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_invocations_actor_time_idx" ON "ai_invocations" USING btree ("actor_user_id","provider_started_at");--> statement-breakpoint
CREATE INDEX "ai_invocations_workspace_managed_period_idx" ON "ai_invocations" USING btree ("workspace_id","funding","usage_period_id","provider_started_at");--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_funding_check" CHECK ("ai_invocations"."funding" in ('managed', 'byok', 'custom'));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_capability_check" CHECK ("ai_invocations"."capability" is null or "ai_invocations"."capability" in ('text', 'vision', 'tts', 'asr'));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_telemetry_version_check" CHECK ("ai_invocations"."telemetry_version" in (1, 2));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_provider_duration_check" CHECK ("ai_invocations"."provider_duration_ms" is null or "ai_invocations"."provider_duration_ms" >= 0);--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_input_hash_check" CHECK ("ai_invocations"."input_hash" is null or length("ai_invocations"."input_hash") = 64);--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_billing_status_check" CHECK ("ai_invocations"."billing_status" in ('unreserved', 'reserved', 'settled', 'released', 'not_applicable'));--> statement-breakpoint
CREATE FUNCTION "prevent_pipeline_run_actor_change"() RETURNS trigger AS $$
BEGIN
	IF OLD."requested_by_user_id" IS NOT NULL
		AND NEW."requested_by_user_id" IS DISTINCT FROM OLD."requested_by_user_id" THEN
		RAISE EXCEPTION 'pipeline run requested_by_user_id is immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "pipeline_runs_requested_by_immutable"
BEFORE UPDATE OF "requested_by_user_id" ON "pipeline_runs"
FOR EACH ROW EXECUTE FUNCTION "prevent_pipeline_run_actor_change"();
