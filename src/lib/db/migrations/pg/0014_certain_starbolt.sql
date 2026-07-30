CREATE TABLE "provider_pool_states" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"current_concurrency" integer DEFAULT 8 NOT NULL,
	"max_concurrency" integer DEFAULT 50 NOT NULL,
	"last_actor_user_id" uuid,
	"clean_since" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_since_adjustment" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_pool_states_scope_key_check" CHECK (length("provider_pool_states"."scope_key") = 64),
	CONSTRAINT "provider_pool_states_current_concurrency_check" CHECK ("provider_pool_states"."current_concurrency" >= 1),
	CONSTRAINT "provider_pool_states_max_concurrency_check" CHECK ("provider_pool_states"."max_concurrency" >= "provider_pool_states"."current_concurrency")
);
--> statement-breakpoint
CREATE TABLE "workflow_concurrency_leases" (
	"workspace_id" uuid NOT NULL,
	"work_unit_key" text NOT NULL,
	"project_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"plan_key" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_concurrency_leases_pkey" PRIMARY KEY("workspace_id","work_unit_key"),
	CONSTRAINT "workflow_concurrency_leases_status_check" CHECK ("workflow_concurrency_leases"."status" in ('waiting', 'active', 'released', 'cancelled', 'expired')),
	CONSTRAINT "workflow_concurrency_leases_plan_check" CHECK ("workflow_concurrency_leases"."plan_key" in ('free', 'plus', 'pro', 'max'))
);
--> statement-breakpoint
ALTER TABLE "workflow_concurrency_leases" ADD CONSTRAINT "workflow_concurrency_leases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_concurrency_leases" ADD CONSTRAINT "workflow_concurrency_leases_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_concurrency_leases" ADD CONSTRAINT "workflow_concurrency_leases_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_concurrency_leases_workspace_status_idx" ON "workflow_concurrency_leases" USING btree ("workspace_id","status","requested_at");