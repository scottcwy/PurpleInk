DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'products', 'brand_kits', 'product_flows', 'releases', 'storyboards',
    'brand_kit_versions', 'product_flow_versions', 'release_brief_versions',
    'storyboard_versions', 'audit_events', 'approvals', 'capture_sessions',
    'capture_upload_intents', 'evidence_manifests', 'discovery_runs',
    'capture_runs', 'node_executions', 'source_assets', 'asset_versions',
    'node_evidence', 'composition_bundles', 'render_jobs', 'render_attempts',
    'artifacts', 'browser_profiles', 'capture_worker_jobs',
    'evidence_packages', 'evidence_package_versions', 'command_receipts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I_pkey', table_name, table_name);
    EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (workspace_id, id)', table_name);
  END LOOP;
END;
$$;

ALTER TABLE capture_session_events
  DROP CONSTRAINT capture_session_events_session_seq_pk;
ALTER TABLE capture_session_events
  ADD PRIMARY KEY (workspace_id, session_id, seq);

ALTER TABLE capture_upload_intents
  DROP CONSTRAINT capture_upload_intents_session_key_unique;
ALTER TABLE capture_upload_intents
  ADD CONSTRAINT capture_upload_intents_workspace_session_key_unique
  UNIQUE (workspace_id, session_id, r2_key);

ALTER TABLE evidence_manifests
  DROP CONSTRAINT evidence_manifests_session_attempt_unique;
ALTER TABLE evidence_manifests
  ADD CONSTRAINT evidence_manifests_workspace_session_attempt_unique
  UNIQUE (workspace_id, session_id, attempt);

ALTER TABLE node_executions
  DROP CONSTRAINT node_executions_run_node_unique;
ALTER TABLE node_executions
  ADD CONSTRAINT node_executions_workspace_run_node_unique
  UNIQUE (workspace_id, capture_run_id, node_id);

ALTER TABLE asset_versions
  DROP CONSTRAINT asset_versions_source_hash_unique;
ALTER TABLE asset_versions
  ADD CONSTRAINT asset_versions_workspace_source_hash_unique
  UNIQUE (workspace_id, source_asset_id, sha256);

ALTER TABLE composition_bundles
  DROP CONSTRAINT composition_bundles_release_plan_unique;
ALTER TABLE composition_bundles
  ADD CONSTRAINT composition_bundles_workspace_release_locale_plan_unique
  UNIQUE (workspace_id, release_id, locale, plan_hash);

ALTER TABLE render_attempts
  DROP CONSTRAINT render_attempts_job_attempt_unique;
ALTER TABLE render_attempts
  ADD CONSTRAINT render_attempts_workspace_job_attempt_unique
  UNIQUE (workspace_id, render_job_id, attempt);

ALTER TABLE brand_kit_versions
  DROP CONSTRAINT brand_kit_versions_aggregate_version_unique;
ALTER TABLE brand_kit_versions
  ADD CONSTRAINT brand_kit_versions_workspace_aggregate_version_unique
  UNIQUE (workspace_id, brand_kit_id, version);

ALTER TABLE product_flow_versions
  DROP CONSTRAINT product_flow_versions_aggregate_version_unique;
ALTER TABLE product_flow_versions
  ADD CONSTRAINT product_flow_versions_workspace_aggregate_version_unique
  UNIQUE (workspace_id, product_flow_id, version);

ALTER TABLE release_brief_versions
  DROP CONSTRAINT release_brief_versions_aggregate_version_unique;
ALTER TABLE release_brief_versions
  ADD CONSTRAINT release_brief_versions_workspace_aggregate_version_unique
  UNIQUE (workspace_id, release_id, version);

ALTER TABLE storyboard_versions
  DROP CONSTRAINT storyboard_versions_aggregate_version_unique;
ALTER TABLE storyboard_versions
  ADD CONSTRAINT storyboard_versions_workspace_aggregate_version_unique
  UNIQUE (workspace_id, storyboard_id, version);

DROP INDEX render_jobs_success_render_key_unique;
CREATE UNIQUE INDEX render_jobs_success_render_key_unique
  ON render_jobs(workspace_id, render_key) WHERE status = 'succeeded';
