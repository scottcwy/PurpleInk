CREATE TABLE "ai_invocations" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"invocation_no" integer NOT NULL,
	"repair_no" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"usage" jsonb,
	"trace_artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_invocations_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "ai_invocations_provider_round_unique" UNIQUE("workspace_id","attempt_id","invocation_no","repair_no"),
	CONSTRAINT "ai_invocations_status_check" CHECK ("ai_invocations"."status" in ('running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_invocations_invocation_no_check" CHECK ("ai_invocations"."invocation_no" > 0),
	CONSTRAINT "ai_invocations_repair_no_check" CHECK ("ai_invocations"."repair_no" between 0 and 2),
	CONSTRAINT "ai_invocations_input_hash_check" CHECK (length("ai_invocations"."input_hash") = 64),
	CONSTRAINT "ai_invocations_output_hash_check" CHECK ("ai_invocations"."output_hash" is null or length("ai_invocations"."output_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"schema_version" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"supersedes_artifact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "artifacts_version_unique" UNIQUE("workspace_id","aggregate_type","aggregate_id","kind","version"),
	CONSTRAINT "artifacts_workspace_project_id_unique" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "artifacts_lifecycle_check" CHECK ("artifacts"."lifecycle" in ('draft', 'approved', 'released', 'rejected')),
	CONSTRAINT "artifacts_version_check" CHECK ("artifacts"."version" > 0),
	CONSTRAINT "artifacts_size_bytes_check" CHECK ("artifacts"."size_bytes" >= 0),
	CONSTRAINT "artifacts_content_hash_check" CHECK (length("artifacts"."content_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "canvas_edges" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" uuid NOT NULL,
	"target" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_edges_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "canvas_edges_endpoints_unique" UNIQUE("workspace_id","project_id","source","target")
);
--> statement-breakpoint
CREATE TABLE "canvas_nodes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"logical_key" text NOT NULL,
	"type" text NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"position_x" double precision NOT NULL,
	"position_y" double precision NOT NULL,
	"data" jsonb NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canvas_nodes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "canvas_nodes_logical_key_unique" UNIQUE("workspace_id","project_id","logical_key"),
	CONSTRAINT "canvas_nodes_workspace_project_id_unique" UNIQUE("workspace_id","project_id","id"),
	CONSTRAINT "canvas_nodes_type_check" CHECK ("canvas_nodes"."type" in (
        'script-import', 'shot-split', 'score', 'export', 'shot-script',
        'shot-codegen', 'shot-sfx', 'shot-subtitle', 'shot-qa'
      )),
	CONSTRAINT "canvas_nodes_stage_check" CHECK ("canvas_nodes"."stage" in (
        'INGEST', 'DIRECT', 'SHOT_SPEC', 'FABRICATE', 'ASSEMBLE', 'FINALIZE'
      )),
	CONSTRAINT "canvas_nodes_status_check" CHECK ("canvas_nodes"."status" in (
        'idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale'
      )),
	CONSTRAINT "canvas_nodes_revision_check" CHECK ("canvas_nodes"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "command_receipts" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"command" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "command_receipts_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "command_receipts_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "command_receipts_status_check" CHECK ("command_receipts"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "command_receipts_fingerprint_check" CHECK (length("command_receipts"."fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "media_routes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"media_task_kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_routes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "media_routes_media_task_kind_unique" UNIQUE("workspace_id","media_task_kind"),
	CONSTRAINT "media_routes_media_task_kind_check" CHECK ("media_routes"."media_task_kind" in ('tts', 'asr')),
	CONSTRAINT "media_routes_revision_check" CHECK ("media_routes"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ai_task_kind" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_routes_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "model_routes_ai_task_kind_unique" UNIQUE("workspace_id","ai_task_kind"),
	CONSTRAINT "model_routes_ai_task_kind_check" CHECK ("model_routes"."ai_task_kind" in (
        'project-plan', 'shot-spec', 'fabricate', 'vision-qa'
      )),
	CONSTRAINT "model_routes_revision_check" CHECK ("model_routes"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger_run_id" text,
	"status" text DEFAULT 'triggering' NOT NULL,
	"workflow_version" text NOT NULL,
	"fingerprint" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "pipeline_runs_trigger_run_unique" UNIQUE("workspace_id","trigger_run_id"),
	CONSTRAINT "pipeline_runs_status_check" CHECK ("pipeline_runs"."status" in (
        'triggering', 'queued', 'running', 'succeeded', 'failed', 'cancelled'
      )),
	CONSTRAINT "pipeline_runs_revision_check" CHECK ("pipeline_runs"."revision" >= 0),
	CONSTRAINT "pipeline_runs_fingerprint_check" CHECK (length("pipeline_runs"."fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"script" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"workflow_version" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"export_settings" jsonb NOT NULL,
	"autopilot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('active', 'archived')),
	CONSTRAINT "projects_revision_check" CHECK ("projects"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"envelope_version" integer NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"nonce" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "provider_credentials_provider_unique" UNIQUE("workspace_id","provider"),
	CONSTRAINT "provider_credentials_envelope_version_check" CHECK ("provider_credentials"."envelope_version" > 0),
	CONSTRAINT "provider_credentials_nonce_length_check" CHECK (octet_length("provider_credentials"."nonce") = 12),
	CONSTRAINT "provider_credentials_auth_tag_length_check" CHECK (octet_length("provider_credentials"."auth_tag") = 16)
);
--> statement-breakpoint
CREATE TABLE "task_attempts" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"fingerprint" text NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"failure" jsonb,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "task_attempts_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "task_attempts_identity_unique" UNIQUE("workspace_id","run_id","task_id","entity_type","entity_id","attempt_no"),
	CONSTRAINT "task_attempts_status_check" CHECK ("task_attempts"."status" in (
        'queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded'
      )),
	CONSTRAINT "task_attempts_attempt_no_check" CHECK ("task_attempts"."attempt_no" > 0),
	CONSTRAINT "task_attempts_revision_check" CHECK ("task_attempts"."revision" >= 0),
	CONSTRAINT "task_attempts_fingerprint_check" CHECK (length("task_attempts"."fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pipeline_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_attempt_fk" FOREIGN KEY ("workspace_id","attempt_id") REFERENCES "public"."task_attempts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_trace_artifact_fk" FOREIGN KEY ("workspace_id","trace_artifact_id") REFERENCES "public"."artifacts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_attempt_fk" FOREIGN KEY ("workspace_id","attempt_id") REFERENCES "public"."task_attempts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_supersedes_fk" FOREIGN KEY ("workspace_id","project_id","supersedes_artifact_id") REFERENCES "public"."artifacts"("workspace_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_source_fk" FOREIGN KEY ("workspace_id","project_id","source") REFERENCES "public"."canvas_nodes"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_edges" ADD CONSTRAINT "canvas_edges_target_fk" FOREIGN KEY ("workspace_id","project_id","target") REFERENCES "public"."canvas_nodes"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "command_receipts" ADD CONSTRAINT "command_receipts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_routes" ADD CONSTRAINT "media_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_run_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."pipeline_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_immutable_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.lifecycle IN ('approved', 'released') THEN
		RAISE EXCEPTION 'approved or released artifacts are immutable'
			USING ERRCODE = '55000';
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER artifacts_immutable_lifecycle_trigger
BEFORE UPDATE OR DELETE ON "artifacts"
FOR EACH ROW
EXECUTE FUNCTION prevent_immutable_artifact_mutation();
