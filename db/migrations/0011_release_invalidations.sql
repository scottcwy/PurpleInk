CREATE TABLE release_invalidations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  release_id uuid NOT NULL,
  command_receipt_id uuid NOT NULL,
  changed_ref text NOT NULL,
  previous_version_id uuid,
  replacement_version_id uuid NOT NULL,
  stale_object_type text NOT NULL,
  stale_object_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT release_invalidations_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT release_invalidations_object_unique UNIQUE (workspace_id,command_receipt_id,stale_object_type,stale_object_id),
  CONSTRAINT release_invalidations_workspace_release_fk FOREIGN KEY (workspace_id,release_id) REFERENCES releases(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT release_invalidations_changed_ref_check CHECK (changed_ref IN ('brief_version','product_flow_version','evidence_package_version','storyboard_version','brand_kit_version')),
  CONSTRAINT release_invalidations_object_type_check CHECK (stale_object_type IN ('product_flow_version','capture_run','evidence_package_version','storyboard_version','composition_bundle','render_job'))
);
