CREATE TABLE "project_sources" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_payload" jsonb NOT NULL,
	"source_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_sources_pkey" PRIMARY KEY("workspace_id","project_id"),
	CONSTRAINT "project_sources_kind_check" CHECK ("project_sources"."kind" in ('script', 'audio', 'website')),
	CONSTRAINT "project_sources_payload_version_check" CHECK (jsonb_typeof("project_sources"."source_payload") = 'object'
        and "project_sources"."source_payload" ->> 'schemaVersion' = '1'),
	CONSTRAINT "project_sources_fingerprint_check" CHECK ("project_sources"."source_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_id_workflow_kind_unique" UNIQUE("workspace_id","id","workflow_kind");--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_project_kind_fk" FOREIGN KEY ("workspace_id","project_id","kind") REFERENCES "public"."projects"("workspace_id","id","workflow_kind") ON DELETE cascade ON UPDATE no action;
