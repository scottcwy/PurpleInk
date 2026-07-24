CREATE TABLE launch_video_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  release_id uuid NOT NULL,
  storyboard_version_id uuid NOT NULL,
  evidence_package_version_id uuid NOT NULL,
  brand_kit_version_id uuid NOT NULL,
  locale text NOT NULL,
  template_version text NOT NULL,
  status text DEFAULT 'queued' NOT NULL,
  current_attempt integer DEFAULT 0 NOT NULL,
  error_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT launch_video_jobs_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT launch_video_jobs_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_jobs_workspace_storyboard_fk FOREIGN KEY (workspace_id,storyboard_version_id) REFERENCES storyboard_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_jobs_workspace_evidence_fk FOREIGN KEY (workspace_id,evidence_package_version_id) REFERENCES evidence_package_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_jobs_workspace_brand_fk FOREIGN KEY (workspace_id,brand_kit_version_id) REFERENCES brand_kit_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_jobs_status_check CHECK (status IN ('queued','running','succeeded','failed','stale')),
  CONSTRAINT launch_video_jobs_attempt_check CHECK (current_attempt >= 0)
);

CREATE TABLE launch_video_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  launch_video_job_id uuid NOT NULL,
  attempt integer NOT NULL,
  release_id uuid NOT NULL,
  storyboard_version_id uuid NOT NULL,
  evidence_package_version_id uuid NOT NULL,
  brand_kit_version_id uuid NOT NULL,
  locale text NOT NULL,
  schema_version text DEFAULT 'launch-video-plan/v1' NOT NULL,
  payload jsonb NOT NULL,
  plan_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT launch_video_plans_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT launch_video_plans_job_attempt_unique UNIQUE (workspace_id,launch_video_job_id,attempt),
  CONSTRAINT launch_video_plans_workspace_job_fk FOREIGN KEY (workspace_id,launch_video_job_id) REFERENCES launch_video_jobs(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_plans_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_plans_workspace_storyboard_fk FOREIGN KEY (workspace_id,storyboard_version_id) REFERENCES storyboard_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_plans_workspace_evidence_fk FOREIGN KEY (workspace_id,evidence_package_version_id) REFERENCES evidence_package_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_plans_workspace_brand_fk FOREIGN KEY (workspace_id,brand_kit_version_id) REFERENCES brand_kit_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT launch_video_plans_attempt_check CHECK (attempt > 0),
  CONSTRAINT launch_video_plans_hash_check CHECK (plan_hash ~ '^[0-9a-f]{64}$')
);

ALTER TABLE composition_bundles
  ADD COLUMN launch_video_job_id uuid,
  ADD COLUMN launch_video_plan_id uuid,
  ADD COLUMN quality_report_r2_key text;
ALTER TABLE composition_bundles ADD CONSTRAINT composition_bundles_workspace_launch_job_fk
  FOREIGN KEY (workspace_id,launch_video_job_id) REFERENCES launch_video_jobs(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE composition_bundles ADD CONSTRAINT composition_bundles_workspace_plan_fk
  FOREIGN KEY (workspace_id,launch_video_plan_id) REFERENCES launch_video_plans(workspace_id,id) ON DELETE RESTRICT;

ALTER TABLE render_jobs ADD COLUMN launch_video_job_id uuid;
ALTER TABLE render_jobs ADD CONSTRAINT render_jobs_workspace_launch_job_fk
  FOREIGN KEY (workspace_id,launch_video_job_id) REFERENCES launch_video_jobs(workspace_id,id) ON DELETE RESTRICT;

ALTER TABLE artifacts
  ADD COLUMN bytes integer,
  ADD COLUMN mime_type text;
ALTER TABLE artifacts ADD CONSTRAINT artifacts_bytes_check CHECK (bytes IS NULL OR bytes > 0);

CREATE TABLE render_job_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  launch_video_job_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT render_job_receipts_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT render_job_receipts_workspace_key_unique UNIQUE (workspace_id,idempotency_key),
  CONSTRAINT render_job_receipts_workspace_job_fk FOREIGN KEY (workspace_id,launch_video_job_id) REFERENCES launch_video_jobs(workspace_id,id) ON DELETE RESTRICT
);
