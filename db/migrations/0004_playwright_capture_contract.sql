ALTER TABLE releases ADD COLUMN evidence_package_version_id uuid;
ALTER TABLE releases ADD COLUMN brand_kit_version_id uuid;

ALTER TABLE brand_kit_versions
  ADD CONSTRAINT brand_kit_versions_workspace_id_id_unique UNIQUE (workspace_id, id);
ALTER TABLE release_brief_versions
  ADD CONSTRAINT release_brief_versions_workspace_id_id_unique UNIQUE (workspace_id, id);

CREATE TABLE browser_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  encrypted_state_ref text NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT browser_profiles_workspace_id_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT browser_profiles_status_check CHECK (status IN ('active','revoked')),
  CONSTRAINT browser_profiles_revision_check CHECK (revision > 0),
  CONSTRAINT browser_profiles_workspace_product_fk
    FOREIGN KEY (workspace_id, product_id) REFERENCES products(workspace_id,id) ON DELETE RESTRICT
);

ALTER TABLE capture_sessions DROP CONSTRAINT capture_sessions_workspace_device_fk;
ALTER TABLE capture_sessions DROP COLUMN device_id;
ALTER TABLE capture_sessions DROP COLUMN attempt;
ALTER TABLE capture_sessions DROP COLUMN run_id;
ALTER TABLE capture_sessions DROP COLUMN flow_version_id;
ALTER TABLE capture_sessions ADD COLUMN browser_profile_id uuid;
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_workspace_profile_fk
  FOREIGN KEY (workspace_id, browser_profile_id) REFERENCES browser_profiles(workspace_id,id) ON DELETE RESTRICT;
DROP TABLE bridge_pairing_codes;
DROP TABLE capture_devices;

CREATE TABLE capture_worker_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  capture_session_id uuid NOT NULL,
  attempt integer NOT NULL,
  browser_profile_id uuid,
  browser_profile_revision integer,
  image_digest text NOT NULL,
  region text NOT NULL,
  status text DEFAULT 'created' NOT NULL,
  lease_token_hash text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT capture_worker_jobs_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT capture_worker_jobs_session_attempt_unique UNIQUE (workspace_id,capture_session_id,attempt),
  CONSTRAINT capture_worker_jobs_attempt_check CHECK (attempt > 0),
  CONSTRAINT capture_worker_jobs_image_digest_check CHECK (image_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT capture_worker_jobs_status_check CHECK (status IN ('created','leased','running','uploading','completed','failed','expired')),
  CONSTRAINT capture_worker_jobs_workspace_session_fk FOREIGN KEY (workspace_id,capture_session_id) REFERENCES capture_sessions(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT capture_worker_jobs_workspace_profile_fk FOREIGN KEY (workspace_id,browser_profile_id) REFERENCES browser_profiles(workspace_id,id) ON DELETE RESTRICT
);

ALTER TABLE discovery_runs ADD COLUMN release_id uuid;
ALTER TABLE discovery_runs ADD COLUMN release_brief_version_id uuid;
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_workspace_release_fk
  FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_workspace_brief_fk
  FOREIGN KEY (workspace_id,release_brief_version_id) REFERENCES release_brief_versions(workspace_id,id) ON DELETE RESTRICT;

CREATE TABLE evidence_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  release_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT evidence_packages_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT evidence_packages_workspace_release_unique UNIQUE (workspace_id,release_id),
  CONSTRAINT evidence_packages_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT
);

CREATE TABLE evidence_package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  evidence_package_id uuid NOT NULL,
  version integer NOT NULL,
  capture_run_id uuid NOT NULL,
  schema_version text DEFAULT 'evidence-package/v1' NOT NULL,
  payload jsonb NOT NULL,
  content_hash text NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT evidence_package_versions_workspace_id_id_unique UNIQUE (workspace_id,id),
  CONSTRAINT evidence_package_versions_aggregate_version_unique UNIQUE (workspace_id,evidence_package_id,version),
  CONSTRAINT evidence_package_versions_version_check CHECK (version > 0),
  CONSTRAINT evidence_package_versions_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT evidence_package_versions_status_check CHECK (status IN ('draft','approved','rejected')),
  CONSTRAINT evidence_package_versions_approval_check CHECK ((status = 'approved') = (approved_at IS NOT NULL)),
  CONSTRAINT evidence_package_versions_workspace_package_fk FOREIGN KEY (workspace_id,evidence_package_id) REFERENCES evidence_packages(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT evidence_package_versions_workspace_capture_fk FOREIGN KEY (workspace_id,capture_run_id) REFERENCES capture_runs(workspace_id,id) ON DELETE RESTRICT
);

CREATE TRIGGER evidence_package_versions_immutable
BEFORE UPDATE OR DELETE ON evidence_package_versions
FOR EACH ROW EXECUTE FUNCTION prevent_approved_version_mutation();

ALTER TABLE releases ADD CONSTRAINT releases_workspace_evidence_package_fk
  FOREIGN KEY (workspace_id,evidence_package_version_id) REFERENCES evidence_package_versions(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE releases ADD CONSTRAINT releases_workspace_brand_kit_version_fk
  FOREIGN KEY (workspace_id,brand_kit_version_id) REFERENCES brand_kit_versions(workspace_id,id) ON DELETE RESTRICT;

ALTER TABLE composition_bundles ADD COLUMN evidence_package_version_id uuid;
ALTER TABLE composition_bundles ADD COLUMN brand_kit_version_id uuid;
ALTER TABLE composition_bundles ADD COLUMN locale text DEFAULT 'en-US' NOT NULL;
ALTER TABLE composition_bundles ADD CONSTRAINT composition_bundles_workspace_evidence_fk
  FOREIGN KEY (workspace_id,evidence_package_version_id) REFERENCES evidence_package_versions(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE composition_bundles ADD CONSTRAINT composition_bundles_workspace_brand_fk
  FOREIGN KEY (workspace_id,brand_kit_version_id) REFERENCES brand_kit_versions(workspace_id,id) ON DELETE RESTRICT;

CREATE TABLE command_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  release_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT command_receipts_workspace_key_unique UNIQUE (workspace_id,idempotency_key),
  CONSTRAINT command_receipts_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT
);
