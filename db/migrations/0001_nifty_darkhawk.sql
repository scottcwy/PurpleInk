CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_decision_check" CHECK ("approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_release_fk" FOREIGN KEY ("workspace_id","release_id") REFERENCES "public"."releases"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_release_created_idx" ON "approvals" USING btree ("workspace_id","release_id","created_at");
--> statement-breakpoint
CREATE FUNCTION prevent_approval_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'approvals is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER approvals_append_only
BEFORE UPDATE OR DELETE ON "approvals"
FOR EACH ROW EXECUTE FUNCTION prevent_approval_mutation();
