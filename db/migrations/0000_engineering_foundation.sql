CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "workspaces_slug_unique" UNIQUE ("slug")
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE ("email")
);

CREATE TABLE "memberships" (
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY ("workspace_id", "user_id"),
  CONSTRAINT "memberships_role_check" CHECK ("role" IN ('owner', 'admin', 'member', 'viewer')),
  CONSTRAINT "memberships_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "memberships_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "memberships_user_id_idx" ON "memberships" ("user_id");

CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "canonical_url" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "products_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "products_canonical_url_https_check" CHECK ("canonical_url" LIKE 'https://%'),
  CONSTRAINT "products_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "products_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "products_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT
);
CREATE INDEX "products_workspace_id_idx" ON "products" ("workspace_id");

CREATE TABLE "brand_kits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brand_kits_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "brand_kits_workspace_product_unique" UNIQUE ("workspace_id", "product_id"),
  CONSTRAINT "brand_kits_workspace_product_fk" FOREIGN KEY ("workspace_id", "product_id") REFERENCES "products"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "product_flows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "name" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "archived_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "product_flows_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "product_flows_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "product_flows_workspace_product_fk" FOREIGN KEY ("workspace_id", "product_id") REFERENCES "products"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "releases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "name" text NOT NULL,
  "lifecycle" text DEFAULT 'active' NOT NULL,
  "stage" text DEFAULT 'brief_draft' NOT NULL,
  "failed_from_stage" text,
  "revision" integer DEFAULT 1 NOT NULL,
  "brief_version_id" uuid,
  "product_flow_version_id" uuid,
  "capture_run_id" uuid,
  "storyboard_version_id" uuid,
  "preview_bundle_id" uuid,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "releases_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "releases_lifecycle_check" CHECK ("lifecycle" IN ('active', 'failed', 'cancelled', 'delivered')),
  CONSTRAINT "releases_stage_check" CHECK ("stage" IN ('brief_draft', 'flow_selecting', 'flow_discovering', 'flow_review', 'capture_pending', 'capturing', 'evidence_review', 'storyboard_generating', 'storyboard_review', 'preview_queued', 'preview_rendering', 'preview_review', 'final_queued', 'final_rendering', 'complete')),
  CONSTRAINT "releases_failed_from_stage_check" CHECK ("failed_from_stage" IS NULL OR "failed_from_stage" IN ('brief_draft', 'flow_selecting', 'flow_discovering', 'flow_review', 'capture_pending', 'capturing', 'evidence_review', 'storyboard_generating', 'storyboard_review', 'preview_queued', 'preview_rendering', 'preview_review', 'final_queued', 'final_rendering', 'complete')),
  CONSTRAINT "releases_failed_lifecycle_check" CHECK (("lifecycle" = 'failed') = ("failed_from_stage" IS NOT NULL)),
  CONSTRAINT "releases_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "releases_workspace_product_fk" FOREIGN KEY ("workspace_id", "product_id") REFERENCES "products"("workspace_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "releases_workspace_id_idx" ON "releases" ("workspace_id");
CREATE INDEX "releases_workspace_product_idx" ON "releases" ("workspace_id", "product_id");

CREATE TABLE "storyboards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "storyboards_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "storyboards_workspace_release_unique" UNIQUE ("workspace_id", "release_id"),
  CONSTRAINT "storyboards_workspace_release_fk" FOREIGN KEY ("workspace_id", "release_id") REFERENCES "releases"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "brand_kit_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "brand_kit_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "brand_kit_versions_aggregate_version_unique" UNIQUE ("brand_kit_id", "version"),
  CONSTRAINT "brand_kit_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "brand_kit_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "brand_kit_versions_status_check" CHECK ("status" IN ('draft', 'approved', 'rejected')),
  CONSTRAINT "brand_kit_versions_approval_check" CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL)),
  CONSTRAINT "brand_kit_versions_workspace_aggregate_fk" FOREIGN KEY ("workspace_id", "brand_kit_id") REFERENCES "brand_kits"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "product_flow_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "product_flow_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "product_flow_versions_aggregate_version_unique" UNIQUE ("product_flow_id", "version"),
  CONSTRAINT "product_flow_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "product_flow_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "product_flow_versions_status_check" CHECK ("status" IN ('draft', 'approved', 'rejected')),
  CONSTRAINT "product_flow_versions_approval_check" CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL)),
  CONSTRAINT "product_flow_versions_workspace_aggregate_fk" FOREIGN KEY ("workspace_id", "product_flow_id") REFERENCES "product_flows"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "release_brief_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "release_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "release_brief_versions_aggregate_version_unique" UNIQUE ("release_id", "version"),
  CONSTRAINT "release_brief_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "release_brief_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "release_brief_versions_status_check" CHECK ("status" IN ('draft', 'approved', 'rejected')),
  CONSTRAINT "release_brief_versions_approval_check" CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL)),
  CONSTRAINT "release_brief_versions_workspace_aggregate_fk" FOREIGN KEY ("workspace_id", "release_id") REFERENCES "releases"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "storyboard_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "storyboard_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "schema_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "storyboard_versions_aggregate_version_unique" UNIQUE ("storyboard_id", "version"),
  CONSTRAINT "storyboard_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "storyboard_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "storyboard_versions_status_check" CHECK ("status" IN ('draft', 'approved', 'rejected')),
  CONSTRAINT "storyboard_versions_approval_check" CHECK (("status" = 'approved') = ("approved_at" IS NOT NULL)),
  CONSTRAINT "storyboard_versions_workspace_aggregate_fk" FOREIGN KEY ("workspace_id", "storyboard_id") REFERENCES "storyboards"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" uuid,
  "event_type" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" uuid NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "audit_events_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT
);
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" ("workspace_id", "created_at");

CREATE FUNCTION prevent_approved_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'approved versions are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER brand_kit_versions_immutable
BEFORE UPDATE OR DELETE ON "brand_kit_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_version_mutation();
CREATE TRIGGER product_flow_versions_immutable
BEFORE UPDATE OR DELETE ON "product_flow_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_version_mutation();
CREATE TRIGGER release_brief_versions_immutable
BEFORE UPDATE OR DELETE ON "release_brief_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_version_mutation();
CREATE TRIGGER storyboard_versions_immutable
BEFORE UPDATE OR DELETE ON "storyboard_versions"
FOR EACH ROW EXECUTE FUNCTION prevent_approved_version_mutation();

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();
