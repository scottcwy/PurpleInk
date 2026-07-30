CREATE TABLE "project_creation_requests" (
	"workspace_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"project_id" uuid NOT NULL,
	"entry_node_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_creation_requests_pkey" PRIMARY KEY("workspace_id","idempotency_key"),
	CONSTRAINT "project_creation_requests_fingerprint_check" CHECK (length("project_creation_requests"."request_fingerprint") = 64)
);
--> statement-breakpoint
ALTER TABLE "project_creation_requests" ADD CONSTRAINT "project_creation_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_creation_requests" ADD CONSTRAINT "project_creation_requests_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_creation_requests" ADD CONSTRAINT "project_creation_requests_entry_node_fk" FOREIGN KEY ("workspace_id","project_id","entry_node_id") REFERENCES "public"."canvas_nodes"("workspace_id","project_id","id") ON DELETE cascade ON UPDATE no action;
