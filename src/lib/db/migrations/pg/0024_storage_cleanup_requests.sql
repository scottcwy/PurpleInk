CREATE TABLE "storage_cleanup_requests" (
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"project_id" uuid,
	"node_id" uuid,
	"attempt_id" uuid,
	"reason" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_cleanup_requests_pkey" PRIMARY KEY("workspace_id","storage_key"),
	CONSTRAINT "storage_cleanup_requests_reason_check" CHECK ("reason" IN ('artifact-registration-failed', 'duplicate-upload', 'creation-failed')),
	CONSTRAINT "storage_cleanup_requests_generation_check" CHECK ("generation" >= 0),
	CONSTRAINT "storage_cleanup_requests_attempt_count_check" CHECK ("attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "storage_cleanup_requests" ADD CONSTRAINT "storage_cleanup_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "storage_cleanup_requests_due_idx" ON "storage_cleanup_requests" USING btree ("workspace_id","next_attempt_at","created_at");
--> statement-breakpoint
CREATE INDEX "storage_cleanup_requests_global_due_idx" ON "storage_cleanup_requests" USING btree ("next_attempt_at","created_at");
