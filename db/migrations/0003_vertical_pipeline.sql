ALTER TABLE product_flow_versions ADD CONSTRAINT product_flow_versions_workspace_id_id_unique UNIQUE (workspace_id, id);
ALTER TABLE storyboard_versions ADD CONSTRAINT storyboard_versions_workspace_id_id_unique UNIQUE (workspace_id, id);

CREATE TABLE discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  product_flow_id uuid NOT NULL, capture_session_id uuid NOT NULL,
  status text DEFAULT 'pending' NOT NULL, proposed_version_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT discovery_runs_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT discovery_runs_status_check CHECK (status IN ('pending','running','completed','failed','cancelled')),
  CONSTRAINT discovery_runs_workspace_flow_fk FOREIGN KEY (workspace_id, product_flow_id) REFERENCES product_flows(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT discovery_runs_workspace_session_fk FOREIGN KEY (workspace_id, capture_session_id) REFERENCES capture_sessions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT discovery_runs_workspace_version_fk FOREIGN KEY (workspace_id, proposed_version_id) REFERENCES product_flow_versions(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE capture_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  release_id uuid NOT NULL, flow_version_id uuid NOT NULL, capture_session_id uuid NOT NULL,
  status text DEFAULT 'pending' NOT NULL, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT capture_runs_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT capture_runs_status_check CHECK (status IN ('pending','running','completed','failed','cancelled')),
  CONSTRAINT capture_runs_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT capture_runs_workspace_flow_version_fk FOREIGN KEY (workspace_id,flow_version_id) REFERENCES product_flow_versions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT capture_runs_workspace_session_fk FOREIGN KEY (workspace_id,capture_session_id) REFERENCES capture_sessions(workspace_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX capture_runs_active_release_unique ON capture_runs(workspace_id,release_id) WHERE status IN ('pending','running');

CREATE TABLE node_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  capture_run_id uuid NOT NULL, node_id text NOT NULL, status text DEFAULT 'pending' NOT NULL,
  started_at timestamptz, finished_at timestamptz, error_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT node_executions_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT node_executions_run_node_unique UNIQUE (capture_run_id,node_id),
  CONSTRAINT node_executions_status_check CHECK (status IN ('pending','running','passed','failed')),
  CONSTRAINT node_executions_workspace_run_fk FOREIGN KEY (workspace_id,capture_run_id) REFERENCES capture_runs(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE source_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  product_id uuid NOT NULL, kind text NOT NULL, created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT source_assets_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT source_assets_workspace_product_fk FOREIGN KEY (workspace_id,product_id) REFERENCES products(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  source_asset_id uuid NOT NULL, r2_key text NOT NULL, sha256 text NOT NULL,
  bytes integer NOT NULL, mime_type text NOT NULL, metadata jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT asset_versions_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT asset_versions_source_hash_unique UNIQUE (source_asset_id,sha256),
  CONSTRAINT asset_versions_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT asset_versions_bytes_check CHECK (bytes > 0),
  CONSTRAINT asset_versions_workspace_source_fk FOREIGN KEY (workspace_id,source_asset_id) REFERENCES source_assets(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE node_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  node_execution_id uuid NOT NULL, kind text NOT NULL, asset_version_id uuid NOT NULL,
  manifest jsonb NOT NULL, approved_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT node_evidence_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT node_evidence_workspace_execution_fk FOREIGN KEY (workspace_id,node_execution_id) REFERENCES node_executions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT node_evidence_workspace_asset_fk FOREIGN KEY (workspace_id,asset_version_id) REFERENCES asset_versions(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE composition_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  release_id uuid NOT NULL, storyboard_version_id uuid NOT NULL,
  plan_hash text NOT NULL, bundle_hash text NOT NULL, r2_key text NOT NULL,
  status text DEFAULT 'created' NOT NULL, created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT composition_bundles_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT composition_bundles_release_plan_unique UNIQUE (release_id,plan_hash),
  CONSTRAINT composition_bundles_hashes_check CHECK (plan_hash ~ '^[0-9a-f]{64}$' AND bundle_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT composition_bundles_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT composition_bundles_workspace_storyboard_fk FOREIGN KEY (workspace_id,storyboard_version_id) REFERENCES storyboard_versions(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  release_id uuid NOT NULL, bundle_id uuid NOT NULL, kind text NOT NULL,
  status text DEFAULT 'queued' NOT NULL, render_key text NOT NULL,
  requested_outputs jsonb NOT NULL, current_attempt integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL, updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT render_jobs_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT render_jobs_attempt_check CHECK (current_attempt >= 0),
  CONSTRAINT render_jobs_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT render_jobs_workspace_bundle_fk FOREIGN KEY (workspace_id,bundle_id) REFERENCES composition_bundles(workspace_id,id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX render_jobs_success_render_key_unique ON render_jobs(render_key) WHERE status = 'succeeded';
CREATE TABLE render_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  render_job_id uuid NOT NULL, attempt integer NOT NULL, status text DEFAULT 'running' NOT NULL,
  error_code text, started_at timestamptz DEFAULT now() NOT NULL, finished_at timestamptz,
  CONSTRAINT render_attempts_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT render_attempts_job_attempt_unique UNIQUE (render_job_id,attempt),
  CONSTRAINT render_attempts_attempt_check CHECK (attempt > 0),
  CONSTRAINT render_attempts_workspace_job_fk FOREIGN KEY (workspace_id,render_job_id) REFERENCES render_jobs(workspace_id,id) ON DELETE RESTRICT
);
CREATE TABLE artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
  render_job_id uuid NOT NULL, attempt_id uuid NOT NULL, kind text NOT NULL,
  r2_key text NOT NULL, sha256 text NOT NULL, metadata jsonb NOT NULL,
  published_at timestamptz, created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT artifacts_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT artifacts_workspace_job_fk FOREIGN KEY (workspace_id,render_job_id) REFERENCES render_jobs(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT artifacts_workspace_attempt_fk FOREIGN KEY (workspace_id,attempt_id) REFERENCES render_attempts(workspace_id,id) ON DELETE RESTRICT
);
