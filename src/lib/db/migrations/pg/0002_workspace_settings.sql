CREATE TABLE "workspace_settings" (
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_settings_pkey" PRIMARY KEY("workspace_id","key"),
	CONSTRAINT "workspace_settings_key_shape_check" CHECK ("workspace_settings"."key" ~ '^[a-z][a-z0-9._-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;