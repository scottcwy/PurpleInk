CREATE TABLE "provider_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_key" text NOT NULL,
	"workspace_id" uuid,
	"attempt_id" uuid,
	"provider" text NOT NULL,
	"funding" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "provider_dispatches_scope_key_check" CHECK (length("provider_dispatches"."scope_key") = 64),
	CONSTRAINT "provider_dispatches_funding_check" CHECK ("provider_dispatches"."funding" in ('managed', 'byok')),
	CONSTRAINT "provider_dispatches_status_check" CHECK ("provider_dispatches"."status" in ('reserved', 'released')),
	CONSTRAINT "provider_dispatches_token_estimate_check" CHECK ("provider_dispatches"."token_estimate" >= 0)
);
--> statement-breakpoint
ALTER TABLE "provider_dispatches" ADD CONSTRAINT "provider_dispatches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_dispatches_scope_reserved_idx" ON "provider_dispatches" USING btree ("scope_key","reserved_at");--> statement-breakpoint
CREATE INDEX "provider_dispatches_scope_lease_idx" ON "provider_dispatches" USING btree ("scope_key","status","lease_expires_at");